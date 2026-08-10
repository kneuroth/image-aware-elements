import {
  estimateResolution,
  type CropRect,
  type Manifest,
  type ManifestInput,
  type ObjectFit,
  type Point,
  type Quad,
  type SurfacePlacement,
} from '@image-aware/core';

export interface EditorImage {
  /** URL the browser can load. */
  readonly url: string;
  /** Path or filename recorded in the manifest. */
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

export interface EditorSurface {
  id: string;
  label: string;
  /** Normalised 0..1 against the image, ordered TL, TR, BR, BL. */
  corners: Quad;
  resolution: [number, number];
  /**
   * Whether the design resolution tracks the quad as corners move.
   *
   * On by default, because a resolution left over from wherever the corners
   * started is silently wrong: content is authored in that coordinate space, so
   * a design rect whose aspect ratio disagrees with the quad's stretches
   * everything projected onto it. Typing a resolution turns this off — an
   * explicit choice should not be overwritten by a nudge.
   */
  autoResolution: boolean;
  clip: boolean;
  z: number;
}

/**
 * One media-gated override of the marking, in the shape the editor can author.
 *
 * Deliberately narrower than the manifest allows: a variant may re-frame the
 * photo, go flat, or show a subset of the surfaces, but it cannot bring its own
 * image — that would mean marking a second photo, which is a different flow.
 * Manifests that do use a per-variant image are kept verbatim in `opaque` and
 * written back untouched, so opening one here never destroys it.
 */
/**
 * How the scene is framed at one size: which part of the photo shows, and what
 * each surface does with itself.
 *
 * The top level of a manifest and each variant carry exactly this, which is what
 * lets the editor treat "Desktop" as just another viewport rather than a special
 * case.
 */
export interface EditorFraming {
  /** Region of the photo to show, as fractions. Null means the whole thing. */
  crop: CropRect | null;
  /** Empty inherits. */
  fit: '' | ObjectFit;
  /** Per-surface overrides, keyed by surface id. Absent means projected. */
  placements: Record<string, SurfacePlacement>;
}

function emptyFraming(): EditorFraming {
  return { crop: null, fit: '', placements: {} };
}

/**
 * One media-gated override of the marking.
 *
 * Deliberately narrower than the manifest allows: a variant may re-frame the
 * photo and re-place its surfaces, but it cannot bring its own image — that
 * would mean marking a second photo, which is a different flow. Manifests that
 * do use a per-variant image are kept verbatim in `opaque` and written back
 * untouched, so opening one here never destroys it.
 */
export interface EditorVariant extends EditorFraming {
  /** Identity for selection and list keys; never written to the manifest. */
  readonly key: string;
  /** CSS media query. Empty means unconditional. */
  media: string;
  /** Set only for variants this editor cannot represent. Written back as-is. */
  opaque: Record<string, unknown> | null;
}

export interface PreviewPreset {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  /**
   * The breakpoint this preset stands for. `null` is the base — what everything
   * wider than the next breakpoint gets. Editing at a preset writes to the
   * variant with this breakpoint, creating it if needed, so the author never
   * writes a media query.
   */
  readonly breakpoint: number | null;
}

export const PREVIEW_PRESETS: readonly PreviewPreset[] = [
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900, breakpoint: null },
  { id: 'laptop', label: 'Laptop', width: 1024, height: 640, breakpoint: 1024 },
  { id: 'tablet', label: 'Tablet', width: 768, height: 1024, breakpoint: 768 },
  { id: 'phone', label: 'Phone', width: 390, height: 844, breakpoint: 480 },
];

/** The query a preset stands for, so the author never has to write one. */
function mediaForBreakpoint(breakpoint: number): string {
  return `(max-width: ${breakpoint}px)`;
}

export interface EditorState {
  image: EditorImage | null;
  surfaces: EditorSurface[];
  /** Framing for the top level: what anything wider than the first breakpoint gets. */
  base: EditorFraming;
  /** Evaluated in order, first match wins; the top level is the implicit fallback. */
  variants: EditorVariant[];
  previewPresetId: string;
  selectedId: string | null;
  /** Index of the corner being dragged or nudged, if any. */
  activeCorner: number | null;
  zoom: number;
  pan: { x: number; y: number };
  /** Cursor position in image pixels, for the status readout. */
  cursor: { x: number; y: number } | null;
  /** Point the loupe is magnifying, in image pixels. */
  loupeAt: Point | null;
  mode: 'mark' | 'preview';
  /** True when a CLI session is available to write the file back to disk. */
  canWriteToDisk: boolean;
  dirty: boolean;
}

type Listener = (state: EditorState) => void;

const state: EditorState = {
  image: null,
  surfaces: [],
  base: emptyFraming(),
  variants: [],
  previewPresetId: 'desktop',
  selectedId: null,
  activeCorner: null,
  zoom: 1,
  pan: { x: 0, y: 0 },
  cursor: null,
  loupeAt: null,
  mode: 'mark',
  canWriteToDisk: false,
  dirty: false,
};

const listeners = new Set<Listener>();

export function getState(): EditorState {
  return state;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Apply a mutation and notify. Kept coarse on purpose — the UI is small. */
export function update(mutate: (draft: EditorState) => void, options: { dirty?: boolean } = {}): void {
  mutate(state);
  syncResolutions(state);
  if (options.dirty) state.dirty = true;
  for (const listener of listeners) listener(state);
}

/**
 * Keep auto resolutions matched to their quads.
 *
 * Done centrally rather than at each mutation site because corners move from
 * three places — dragging, arrow keys, and the orientation sliders — and missing
 * one would reintroduce exactly the bug this exists to prevent.
 */
function syncResolutions(state: EditorState): void {
  if (!state.image) return;
  for (const surface of state.surfaces) {
    if (!surface.autoResolution) continue;
    const [width, height] = estimateResolution(surface.corners, state.image);
    if (width !== surface.resolution[0] || height !== surface.resolution[1]) {
      surface.resolution = [width, height];
    }
  }
}

/** True when a stored resolution is what the quad would have produced anyway. */
export function looksAutoResolved(
  resolution: readonly [number, number],
  corners: Quad,
  image: EditorImage,
): boolean {
  const [width, height] = estimateResolution(corners, image);
  return resolution[0] === width && resolution[1] === height;
}

export function selectedSurface(): EditorSurface | null {
  return state.surfaces.find((surface) => surface.id === state.selectedId) ?? null;
}

export function previewPreset(): PreviewPreset {
  return PREVIEW_PRESETS.find((p) => p.id === state.previewPresetId) ?? PREVIEW_PRESETS[0]!;
}

let variantCounter = 0;

/**
 * The variant a preset stands for, or null when it is the base.
 *
 * Prefers the variant whose query is exactly the preset's own breakpoint, then
 * falls back to whichever variant would actually match at that size — so a
 * hand-written manifest with `(max-width: 900px)` is still editable from the
 * Tablet preset rather than being invisible.
 */
export function variantForPreset(
  state: EditorState,
  preset: PreviewPreset,
  matches: (media: string, viewport: PreviewPreset) => boolean | null,
): EditorVariant | null {
  if (preset.breakpoint === null) return null;

  const canonical = mediaForBreakpoint(preset.breakpoint);
  const exact = state.variants.find((variant) => variant.media === canonical);
  if (exact) return exact;

  return state.variants.find((variant) => matches(variant.media, preset) === true) ?? null;
}

/** The framing a preset edits: an existing variant, or the base. */
export function framingForPreset(
  state: EditorState,
  preset: PreviewPreset,
  matches: (media: string, viewport: PreviewPreset) => boolean | null,
): EditorFraming {
  return variantForPreset(state, preset, matches) ?? state.base;
}

/**
 * Find or create the framing a preset edits, then mutate it.
 *
 * Creating on first edit rather than up front is what removes the "add variant"
 * step: you pick a viewport, change something, and the variant exists. New
 * variants are inserted narrowest-first, because the runtime takes the first
 * match and a wider query placed earlier would shadow every narrower one.
 */
export function editFraming(
  preset: PreviewPreset,
  matches: (media: string, viewport: PreviewPreset) => boolean | null,
  mutate: (framing: EditorFraming) => void,
): void {
  update((draft) => {
    if (preset.breakpoint === null) {
      mutate(draft.base);
      return;
    }

    const existing = variantForPreset(draft, preset, matches);
    if (existing) {
      mutate(existing);
      return;
    }

    const created: EditorVariant = {
      key: `variant-${++variantCounter}`,
      media: mediaForBreakpoint(preset.breakpoint),
      ...emptyFraming(),
      opaque: null,
    };
    mutate(created);

    const index = draft.variants.findIndex(
      (variant) => breakpointOf(variant.media) > preset.breakpoint!,
    );
    if (index === -1) draft.variants.push(created);
    else draft.variants.splice(index, 0, created);
  }, { dirty: true });
}

/**
 * The max-width a query stands for, or Infinity when it has none.
 *
 * Only used for ordering. A query without a width bound sorts last among
 * variants, before the unconditional base.
 */
function breakpointOf(media: string): number {
  const match = /\(\s*max-width\s*:\s*([\d.]+)px\s*\)/.exec(media.toLowerCase());
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

/** A fresh surface covering the middle of the image, ready to be dragged. */
export function createSurface(image: EditorImage, existing: readonly EditorSurface[]): EditorSurface {
  const id = uniqueId('surface', existing);
  const corners: Quad = [
    [0.3, 0.3],
    [0.7, 0.3],
    [0.7, 0.7],
    [0.3, 0.7],
  ];
  const [width, height] = estimateResolution(corners, image);
  return {
    id,
    label: 'New surface',
    corners,
    resolution: [width, height],
    autoResolution: true,
    clip: true,
    z: existing.length,
  };
}

export function uniqueId(base: string, existing: readonly EditorSurface[], ignore?: string): string {
  const taken = new Set(existing.map((s) => s.id).filter((id) => id !== ignore));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function serialiseSurface(surface: EditorSurface) {
  return {
    id: surface.id,
    label: surface.label,
    corners: surface.corners,
    resolution: surface.resolution,
    clip: surface.clip,
    z: surface.z,
  };
}

/**
 * Build the manifest that will be written to disk.
 *
 * `variants` is omitted entirely when there are none, so a photo with one
 * marking still produces exactly the file it always did. Responsiveness should
 * cost nothing until you ask for it.
 */
function serialiseFraming(framing: EditorFraming) {
  const placements = Object.entries(framing.placements).filter(
    ([, placement]) => placement !== 'projected',
  );
  return {
    ...(framing.fit ? { fit: framing.fit } : {}),
    ...(framing.crop ? { crop: framing.crop } : {}),
    ...(placements.length > 0 ? { placements: Object.fromEntries(placements) } : {}),
  };
}

export function toManifest(state: EditorState): ManifestInput | null {
  if (!state.image) return null;

  const variants = state.variants.map((variant) =>
    variant.opaque
      ? variant.opaque
      : {
          ...(variant.media ? { media: variant.media } : {}),
          ...serialiseFraming(variant),
        },
  );

  return {
    version: 1,
    image: { src: state.image.src, width: state.image.width, height: state.image.height },
    surfaces: state.surfaces.map(serialiseSurface),
    ...serialiseFraming(state.base),
    ...(variants.length > 0 ? { variants } : {}),
  } as ManifestInput;
}

/**
 * The manifest the preview renders: one variant, resolved, with no media gating.
 *
 * The preview frame is a div rather than the real viewport, so leaving the media
 * queries in would make the element answer to the browser window instead of the
 * chosen preset. Handing it a single unconditional variant sidesteps that
 * entirely — and the element still does all the actual work.
 */
export function toPreviewManifest(
  state: EditorState,
  framing: EditorFraming,
): Manifest | null {
  if (!state.image) return null;

  return {
    version: 1,
    image: { src: state.image.src, width: state.image.width, height: state.image.height },
    surfaces: state.surfaces.map((surface) => ({
      id: surface.id,
      label: surface.label,
      corners: surface.corners,
      resolution: surface.resolution,
      clip: surface.clip,
      z: surface.z,
    })),
    ...(framing.crop ? { crop: framing.crop } : {}),
    ...(framing.fit ? { fit: framing.fit } : {}),
    placements: framing.placements,
  };
}

/** Load a manifest into the editor, replacing whatever is there. */
export function fromManifest(manifest: Manifest, image: EditorImage): EditorSurface[] {
  return manifest.surfaces.map((surface, index) => {
    const resolution: [number, number] = [surface.resolution[0], surface.resolution[1]];
    return {
      id: surface.id,
      label: surface.label ?? surface.id,
      corners: surface.corners,
      resolution,
      // A stored value that differs from the estimate was chosen deliberately —
      // someone designing against a round 1280x800, say — so leave it alone.
      autoResolution: looksAutoResolved(resolution, surface.corners, image),
      clip: surface.clip ?? true,
      z: surface.z ?? index,
    };
  });
}

/**
 * Read variants from the *raw* JSON rather than the parsed manifest.
 *
 * `parseManifest` resolves inheritance and appends the top-level fallback, which
 * is exactly what a renderer wants and exactly what an editor must not have:
 * saving a resolved variant would bake inherited values into the file and add a
 * duplicate of the top level.
 */
export function variantsFromRaw(raw: unknown): EditorVariant[] {
  const root = raw as { variants?: unknown } | null;
  if (!root || !Array.isArray(root.variants)) return [];

  return root.variants.map((entry): EditorVariant => {
    const value = (entry ?? {}) as Record<string, unknown>;
    const key = `variant-${++variantCounter}`;
    const media = typeof value['media'] === 'string' ? value['media'] : '';

    // Anything carrying its own image is outside what this editor can express.
    if (value['image'] !== undefined) {
      return { key, media, ...emptyFraming(), opaque: value };
    }

    return { key, media, ...framingFromRaw(value), opaque: null };
  });
}

/** Read one framing out of raw JSON, tolerating anything unexpected. */
export function framingFromRaw(value: Record<string, unknown> | null | undefined): EditorFraming {
  const raw = value ?? {};
  const fit = raw['fit'];
  const crop = raw['crop'];
  const placements = raw['placements'];

  return {
    fit: fit === 'contain' || fit === 'cover' || fit === 'fill' ? fit : '',
    crop:
      Array.isArray(crop) && crop.length === 4 && crop.every((n) => typeof n === 'number')
        ? (crop as unknown as CropRect)
        : null,
    placements:
      typeof placements === 'object' && placements !== null && !Array.isArray(placements)
        ? // `flat` predates per-surface placements; treat it as "everything flows"
          (placements as Record<string, SurfacePlacement>)
        : raw['flat']
          ? {}
          : {},
  };
}
