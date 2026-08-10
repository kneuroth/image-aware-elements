import {
  computeLayout,
  observeSize,
  parseManifest,
  parseObjectPosition,
  prepareManifest,
  selectVariant,
  type Layout,
  type Manifest,
  type ManifestSource,
  type ObjectFit,
  type PreparedManifest,
  type PreparedVariant,
  type Size,
} from '@image-aware/core';
import { STYLES } from './styles.js';

const FITS = new Set<ObjectFit>(['contain', 'cover', 'fill']);

/**
 * Event names are hyphenated (`image-surface-layout`), not colon-namespaced
 * (`image-surface:layout`), even though the latter is common for custom elements.
 *
 * Angular's template parser reads `x:y` inside an event binding as
 * `globalTarget:event` and rejects anything but `window`, `document` or `body`,
 * so a colon in the name makes the event unbindable from an Angular template
 * altogether. Hyphens work everywhere.
 */
export const EVENTS = {
  load: 'image-surface-load',
  layout: 'image-surface-layout',
  error: 'image-surface-error',
} as const;

/** Which media-gated variant is currently on screen. */
export interface ActiveVariant {
  readonly index: number;
  readonly media: string | undefined;
  readonly flat: boolean;
}

/** Detail of the `image-surface-layout` event. */
export interface LayoutEventDetail {
  readonly layout: Layout;
  readonly variant: ActiveVariant;
}

/** Detail of the `image-surface-error` event. */
export interface ErrorEventDetail {
  readonly error: Error;
}

/**
 * `<image-surface>` — renders a photo and projects slotted HTML onto the flat
 * surfaces marked inside it.
 *
 * ```html
 * <image-surface src="/laptop.jpg" manifest="/laptop.surfaces.json" fit="cover">
 *   <div slot="laptop-screen">…anything…</div>
 * </image-surface>
 * ```
 *
 * Slotted content stays in the light DOM, so the page's own CSS reaches it
 * normally; only the transform machinery is encapsulated.
 */
export class ImageSurfaceElement extends HTMLElement {
  static readonly observedAttributes = ['src', 'manifest', 'fit', 'object-position', 'flat'] as const;

  #root: HTMLDivElement;
  #img: HTMLImageElement;
  #surfaceHost: HTMLDivElement;
  #shadow: ShadowRoot;

  #prepared: PreparedManifest | null = null;
  #variant: PreparedVariant | null = null;
  #manifestSource: ManifestSource | null = null;
  #layout: Layout | null = null;
  #containerSize: Size = { width: 0, height: 0 };
  #naturalSize: Size | null = null;
  #stopObserving: (() => void) | null = null;
  /** Guards against a slow manifest fetch resolving after a newer one. */
  #loadToken = 0;
  #surfaceNodes = new Map<string, HTMLDivElement>();
  /** Base for resolving the manifest's relative image path. */
  #baseUrl: string | undefined;
  /** One MediaQueryList per gated variant, bound up front so selection is deterministic. */
  #media = new Map<string, MediaQueryList>();

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLES;

    this.#root = document.createElement('div');
    this.#root.setAttribute('part', 'root');

    this.#img = document.createElement('img');
    this.#img.setAttribute('part', 'image');
    this.#img.alt = '';
    this.#img.decoding = 'async';
    this.#img.addEventListener('load', this.#onImageLoad);
    this.#img.addEventListener('error', () => {
      this.#fail(new Error(`Failed to load image: ${this.#img.src}`));
    });

    this.#surfaceHost = document.createElement('div');
    this.#surfaceHost.setAttribute('part', 'surfaces');

    this.#root.append(this.#img, this.#surfaceHost);
    this.#shadow.append(style, this.#root);
  }

  /**
   * The manifest. Accepts a parsed object (for bundler `import` of JSON) or a URL
   * string, which will be fetched.
   */
  get manifest(): ManifestSource | null {
    return this.#manifestSource;
  }

  set manifest(value: ManifestSource | null) {
    this.#manifestSource = value;
    void this.#loadManifest();
  }

  get src(): string {
    return this.getAttribute('src') ?? '';
  }

  set src(value: string) {
    this.setAttribute('src', value);
  }

  get fit(): ObjectFit {
    const attr = this.getAttribute('fit') as ObjectFit | null;
    if (attr && FITS.has(attr)) return attr;
    return this.#variant?.fit ?? 'contain';
  }

  set fit(value: ObjectFit) {
    this.setAttribute('fit', value);
  }

  /**
   * True when the surfaces are not being projected and slotted content is laid
   * out as ordinary blocks.
   *
   * A surface that renders 200px wide on a phone cannot hold a tappable menu, so
   * below some width the honest thing is to stop pretending. Entirely opt-in: a
   * manifest that declares no flat variant never goes flat.
   *
   * The attribute is deliberately tri-state rather than a plain boolean, because
   * a page may need to overrule a manifest it does not own:
   *
   * - absent — defer to the active variant
   * - `flat` / `flat=""` / anything else — force projection off
   * - `flat="false"` — force projection *on*, whatever the manifest says
   *
   * Treating the bare presence of the attribute as "on" and `"false"` as "off"
   * departs from how boolean HTML attributes normally work, but the alternative
   * is `flat="false"` silently meaning "flat", which is worse.
   */
  get flat(): boolean {
    const attribute = this.getAttribute('flat');
    if (attribute === null) return this.#variant?.flat ?? false;
    return attribute !== 'false';
  }

  /** The most recent computed layout, or `null` before the manifest resolves. */
  get layout(): Layout | null {
    return this.#layout;
  }

  /** Which variant is on screen, or `null` before the manifest resolves. */
  get variant(): ActiveVariant | null {
    return this.#variant ? this.#describeVariant(this.#variant) : null;
  }

  connectedCallback(): void {
    this.#stopObserving = observeSize(this, (size) => {
      this.#containerSize = size;
      this.#render();
    });
    if (!this.#prepared && this.#manifestSource) void this.#loadManifest();
  }

  disconnectedCallback(): void {
    this.#stopObserving?.();
    this.#stopObserving = null;
    this.#unbindMedia();
  }

  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (previous === next) return;
    switch (name) {
      case 'src':
        this.#applyImageSrc();
        break;
      case 'manifest':
        if (next !== null) this.manifest = next;
        break;
      case 'fit':
      case 'object-position':
      case 'flat':
        this.#render();
        break;
    }
  }

  /** Recompute transforms immediately, e.g. after mutating the manifest in place. */
  refresh(): void {
    this.#render();
  }

  async #loadManifest(): Promise<void> {
    const source = this.#manifestSource;
    const token = ++this.#loadToken;
    if (!source) return;

    try {
      let raw: unknown = source;
      let baseUrl: string | undefined;

      if (typeof source === 'string') {
        baseUrl = new URL(source, document.baseURI).href;
        const response = await fetch(baseUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch manifest (${response.status}): ${baseUrl}`);
        }
        raw = await response.json();
      }

      // A newer manifest was requested while this fetch was in flight.
      if (token !== this.#loadToken) return;

      const manifest = parseManifest(raw);
      this.#prepared = prepareManifest(manifest);
      this.#baseUrl = baseUrl;
      this.#bindMedia();
      this.#applyVariant({ force: true });
      this.dispatchEvent(new CustomEvent('image-surface-load', { detail: { manifest } }));
    } catch (error) {
      if (token !== this.#loadToken) return;
      this.#fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Bind every gated variant's media query up front.
   *
   * Binding lazily during selection would also work — selection never reaches
   * past the first match, and any change to an earlier match fires a bound
   * listener — but that argument has to be re-derived every time someone reads
   * this code. Binding all of them is a handful of listeners and no argument.
   */
  #bindMedia(): void {
    this.#unbindMedia();
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    for (const variant of this.#prepared?.variants ?? []) {
      if (variant.media === undefined || this.#media.has(variant.media)) continue;
      const query = window.matchMedia(variant.media);
      query.addEventListener('change', this.#onMediaChange);
      this.#media.set(variant.media, query);
    }
  }

  #unbindMedia(): void {
    for (const query of this.#media.values()) {
      query.removeEventListener('change', this.#onMediaChange);
    }
    this.#media.clear();
  }

  #onMediaChange = (): void => {
    this.#applyVariant();
  };

  /** Re-select the variant and, when it changed, rebuild everything tied to it. */
  #applyVariant({ force = false }: { force?: boolean } = {}): void {
    if (!this.#prepared) return;

    const next = selectVariant(this.#prepared, (media) => this.#media.get(media)?.matches ?? false);
    if (!force && next === this.#variant) {
      this.#render();
      return;
    }

    const previousImage = this.#variant?.image.src;
    this.#variant = next;

    // A different photo means the old natural size is stale, and the maths must
    // not use it for even one frame.
    if (next.image.src !== previousImage) this.#naturalSize = null;

    this.style.setProperty('--image-aware-aspect', `${next.image.width} / ${next.image.height}`);
    this.#buildSurfaces();
    this.#applyImageSrc();
    this.#render();
  }

  /**
   * The `src` attribute wins; otherwise fall back to the active variant's image
   * path, resolved relative to the manifest so a manifest sitting next to its
   * photo just works.
   */
  #applyImageSrc(): void {
    const explicit = this.getAttribute('src');
    if (explicit) {
      this.#img.src = explicit;
      return;
    }
    const fromManifest = this.#variant?.image.src;
    if (fromManifest) {
      this.#img.src = this.#baseUrl
        ? new URL(fromManifest, this.#baseUrl).href
        : fromManifest;
    }
  }

  #onImageLoad = (): void => {
    const { naturalWidth, naturalHeight } = this.#img;
    if (naturalWidth > 0 && naturalHeight > 0) {
      this.#naturalSize = { width: naturalWidth, height: naturalHeight };
      this.#warnOnAspectMismatch();
    }
    this.#render();
  };

  /**
   * The browser's `object-fit` uses the file's real aspect ratio, while the
   * corner math uses the manifest's declared one. If they disagree the content
   * drifts off its surface — subtly, and only at some container sizes, which is
   * miserable to debug. Say so loudly instead.
   */
  #warnOnAspectMismatch(): void {
    const declared = this.#variant?.image;
    const actual = this.#naturalSize;
    if (!declared || !actual) return;

    const declaredAspect = declared.width / declared.height;
    const actualAspect = actual.width / actual.height;
    if (Math.abs(declaredAspect - actualAspect) / declaredAspect > 0.01) {
      console.warn(
        `[image-aware] Image aspect ratio (${actual.width}x${actual.height}) does not match ` +
          `the manifest's declared size (${declared.width}x${declared.height}). ` +
          `Surfaces will not line up. Re-mark the image or fix image.width/height.`,
      );
    }
  }

  /** Rebuild one absolutely-positioned host per surface, each wrapping a named slot. */
  #buildSurfaces(): void {
    this.#surfaceHost.replaceChildren();
    this.#surfaceNodes.clear();
    if (!this.#variant) return;

    for (const surface of this.#variant.surfaces) {
      const node = document.createElement('div');
      node.setAttribute('part', 'surface');
      node.dataset['id'] = surface.id;
      node.dataset['clip'] = String(surface.clip);

      const slot = document.createElement('slot');
      slot.name = surface.id;
      node.append(slot);

      this.#surfaceHost.append(node);
      this.#surfaceNodes.set(surface.id, node);

      if (!surface.ok) {
        console.warn(
          `[image-aware] Surface "${surface.id}" has an unusable quad ` +
            `(${surface.issues.join(', ')}) and will not be rendered.`,
        );
      }
    }
  }

  /**
   * Resolve `object-position` from, in order: the CSS custom property, the
   * attribute, then the variant.
   *
   * The custom property wins because it is the only one a media query can reach,
   * and it is only ever set deliberately. The resolved value is applied to the
   * photo *and* fed to the transform maths from this single place — they were
   * previously read from different sources, so moving the crop moved the
   * surfaces off the photo.
   */
  #resolveObjectPosition(): string {
    const fromCss = getComputedStyle(this).getPropertyValue('--image-aware-object-position').trim();
    if (fromCss) return fromCss;
    return this.getAttribute('object-position') ?? this.#variant?.objectPosition ?? '50% 50%';
  }

  #describeVariant(variant: PreparedVariant): ActiveVariant {
    return {
      index: this.#prepared?.variants.indexOf(variant) ?? 0,
      media: variant.media,
      flat: this.flat,
    };
  }

  #render(): void {
    const variant = this.#variant;
    if (!variant) return;
    const { width, height } = this.#containerSize;
    if (width <= 0 || height <= 0) return;

    const objectPosition = this.#resolveObjectPosition();
    this.#img.style.objectPosition = objectPosition;
    this.style.setProperty('--image-aware-fit', this.fit);

    // An explicit `flat` attribute is a blunt override: it decides every surface
    // and discards per-surface placements, because "I want the projection" (or
    // not) should not be argued with by the manifest it is overruling.
    const override = this.getAttribute('flat');
    const forced = override === null ? null : override !== 'false';

    // Prefer the file's real dimensions once known: that is what object-fit
    // actually laid the photo out with, and disagreeing with it would drift
    // every surface.
    const imageSize = this.#naturalSize ?? variant.image;
    const source: PreparedVariant = {
      ...variant,
      image: { ...variant.image, width: imageSize.width, height: imageSize.height },
      ...(forced === null ? {} : { flat: forced, placements: {} }),
    };

    const layout = computeLayout(
      source,
      this.#containerSize,
      this.fit,
      parseObjectPosition(objectPosition),
    );
    this.#layout = layout;

    // The photo is normally laid out by `object-fit`, but a crop is a region
    // plus a zoom, which object-fit cannot express. Position it explicitly from
    // the same imageRect the transforms are built on — one source of truth.
    if (variant.crop) {
      const rect = layout.imageRect;
      Object.assign(this.#img.style, {
        position: 'absolute',
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        objectFit: 'fill',
      });
    } else {
      Object.assign(this.#img.style, {
        position: '',
        left: '',
        top: '',
        width: '',
        height: '',
        objectFit: '',
      });
    }

    let anyInFlow = false;

    for (const surface of layout.surfaces) {
      const node = this.#surfaceNodes.get(surface.id);
      if (!node) continue;

      const placement = surface.placement;
      node.dataset['placement'] = typeof placement === 'string' ? placement : 'float';
      // An unusable quad only matters when projected; unprojected content shows.
      node.dataset['ok'] = String(placement === 'projected' ? surface.ok : true);
      node.style.zIndex = String(surface.z);

      if (placement === 'projected') {
        node.style.width = `${surface.resolution.width}px`;
        node.style.height = `${surface.resolution.height}px`;
        node.style.transform = surface.matrix3d;
        node.style.left = '';
        node.style.top = '';
        continue;
      }

      // Clear what projection put there rather than fighting it from the
      // stylesheet: inline styles would otherwise need !important to undo.
      node.style.transform = '';

      if (placement === 'flow' || placement === 'none') {
        node.style.width = '';
        node.style.height = '';
        node.style.left = '';
        node.style.top = '';
        if (placement === 'flow') anyInFlow = true;
        continue;
      }

      // Floating: a rectangle in container fractions, so it scales with the
      // screen rather than being pinned to a pixel size.
      const [x, y, width, height] = placement.rect;
      node.style.left = `${x * 100}%`;
      node.style.top = `${y * 100}%`;
      node.style.width = `${width * 100}%`;
      node.style.height = `${height * 100}%`;
    }

    // Content in normal flow gives the element real height, which a fixed
    // aspect-ratio would fight.
    this.toggleAttribute('data-flow', anyInFlow);
    // The authoring hook: nothing is projected, so design-space lengths in
    // slotted CSS no longer mean anything.
    this.toggleAttribute(
      'data-flat',
      layout.surfaces.length > 0 &&
        layout.surfaces.every((surface) => surface.placement !== 'projected'),
    );

    this.dispatchEvent(
      new CustomEvent<LayoutEventDetail>('image-surface-layout', {
        detail: { layout, variant: this.#describeVariant(variant) },
      }),
    );
  }

  #fail(error: Error): void {
    console.error('[image-aware]', error);
    this.dispatchEvent(
      new CustomEvent<ErrorEventDetail>('image-surface-error', { detail: { error } }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'image-surface': ImageSurfaceElement;
  }
}
