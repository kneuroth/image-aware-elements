import { contentRect, cropContentRect } from './fit.js';
import {
  mapQuad,
  rectToQuad,
  scaleHomography,
  solveHomography,
  toMatrix3d,
  translateHomography,
} from './homography.js';
import type { Manifest, ManifestSurface, ManifestVariant } from './manifest.js';
import { validateQuad, type QuadIssue } from './quad.js';
import type {
  CropRect,
  Homography,
  ObjectFit,
  Point,
  Quad,
  Rect,
  Size,
  SurfacePlacement,
} from './types.js';

export interface PreparedSurface {
  readonly id: string;
  readonly label: string | undefined;
  readonly resolution: Size;
  readonly clip: boolean;
  readonly z: number;
  readonly corners: Quad;
  /**
   * Design pixels -> the unit square. Solved once, then scaled and translated to
   * whatever the container turns out to be.
   */
  readonly reference: Homography | null;
  readonly ok: boolean;
  readonly issues: readonly QuadIssue[];
}

/** One media-gated rendering of the scene, with its surfaces already solved. */
export interface PreparedVariant {
  /** Undefined means unconditional — it always matches. */
  readonly media: string | undefined;
  readonly image: Size & { readonly src: string };
  readonly fit: ObjectFit;
  readonly objectPosition: string | undefined;
  /** Region of the photo to show. Wins over fit/objectPosition when present. */
  readonly crop: CropRect | null;
  readonly flat: boolean;
  /** Per-surface overrides. Anything absent is projected, unless `flat`. */
  readonly placements: Readonly<Record<string, SurfacePlacement>>;
  readonly surfaces: readonly PreparedSurface[];
}

export interface PreparedManifest {
  /** Never empty. The last entry is unconditional. */
  readonly variants: readonly PreparedVariant[];
}

export interface SurfaceLayout {
  readonly id: string;
  readonly resolution: Size;
  readonly clip: boolean;
  readonly z: number;
  /** Ready to assign to `style.transform`. Empty string when the quad is invalid. */
  readonly matrix3d: string;
  /**
   * Where the surface's four corners actually land in the container, in CSS px.
   *
   * This is the honest answer to "how big is this on screen right now", which is
   * the question that decides whether a projected control is tappable. Callers
   * can also intersect it with the container to see how much has been cropped
   * away — under `fit=cover` on a narrow viewport, a surface can be entirely
   * outside the visible area while its transform stays perfectly correct.
   */
  readonly quad: Quad;
  /**
   * Shortest projected edge as a fraction of its design-space length. Below ~1 a
   * surface is minified, so design-space px shrink on screen: a 44px button at
   * `scale` 0.5 is a 22px tap target.
   */
  readonly scale: number;
  /**
   * How this surface is being rendered. Only `projected` carries a transform;
   * the rest are laid out by the adapter as ordinary or positioned content, and
   * report a zero quad because there is no projection to describe.
   */
  readonly placement: SurfacePlacement;
  readonly ok: boolean;
  readonly issues: readonly QuadIssue[];
}

export interface Layout {
  /** Where the photo actually sits inside the container under the current fit. */
  readonly imageRect: Rect;
  readonly surfaces: readonly SurfaceLayout[];
}

/**
 * Do the expensive part once, for every variant.
 *
 * Each surface's homography is solved against the *unit square* rather than any
 * particular pixel size. Resizing then costs six multiplications instead of an
 * 8x8 solve, so a window drag stays cheap no matter how many surfaces the photo
 * carries — and crossing a breakpoint costs nothing either, because every
 * variant was solved up front.
 */
export function prepareManifest(manifest: Manifest): PreparedManifest {
  const declared = manifest.variants ?? [];
  const variants = declared.length > 0 ? declared : [defaultVariant(manifest)];
  return { variants: variants.map(prepareVariant) };
}

function defaultVariant(manifest: Manifest): ManifestVariant {
  return {
    image: manifest.image,
    surfaces: manifest.surfaces,
    ...(manifest.fit ? { fit: manifest.fit } : {}),
    ...(manifest.crop ? { crop: manifest.crop } : {}),
    ...(manifest.placements ? { placements: manifest.placements } : {}),
  };
}

function prepareVariant(variant: ManifestVariant): PreparedVariant {
  return {
    media: variant.media,
    image: {
      src: variant.image.src,
      width: variant.image.width,
      height: variant.image.height,
    },
    fit: variant.fit ?? 'contain',
    objectPosition: variant.objectPosition,
    crop: variant.crop ?? null,
    flat: variant.flat ?? false,
    placements: variant.placements ?? {},
    surfaces: variant.surfaces.map(prepareSurface),
  };
}

/** `flat` is shorthand for "every surface flows"; an explicit placement wins. */
function placementOf(variant: PreparedVariant, id: string): SurfacePlacement {
  return variant.placements[id] ?? (variant.flat ? 'flow' : 'projected');
}

/**
 * Pick the variant to render, first match wins.
 *
 * Takes a matcher rather than touching `matchMedia` so the whole responsive
 * story stays testable in Node — same reason `computeLayout` is pure.
 */
export function selectVariant(
  prepared: PreparedManifest,
  matches: (media: string) => boolean,
): PreparedVariant {
  for (const variant of prepared.variants) {
    if (variant.media === undefined || matches(variant.media)) return variant;
  }
  // parseManifest guarantees an unconditional final entry; fall back to it anyway
  // rather than throwing at render time on a hand-built manifest.
  return prepared.variants[prepared.variants.length - 1]!;
}

function prepareSurface(surface: ManifestSurface): PreparedSurface {
  const resolution: Size = { width: surface.resolution[0], height: surface.resolution[1] };
  const corners = surface.corners;

  // Validate in normalised space. Convexity and projective depth signs are both
  // invariant under the scale/translate applied later, so one check covers every
  // container size.
  const validation = validateQuad(corners, resolution);
  const reference = validation.ok ? solveHomography(rectToQuad(resolution), corners) : null;

  return {
    id: surface.id,
    label: surface.label,
    resolution,
    clip: surface.clip ?? true,
    z: surface.z ?? 0,
    corners,
    reference,
    ok: validation.ok && reference !== null,
    issues: validation.issues,
  };
}

const DEGENERATE_QUAD: Quad = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];

/**
 * Turn a prepared variant plus a container size into ready-to-apply transforms.
 *
 * Pure: no DOM, no observers, no caching. That makes the whole responsive story
 * unit-testable without a browser.
 */
export function computeLayout(
  variant: PreparedVariant,
  container: Size,
  fit: ObjectFit = variant.fit,
  objectPosition: Point = [0.5, 0.5],
): Layout {
  // A crop says which region of the photo to show, which fit and object-position
  // together cannot express: they pan but do not zoom.
  const imageRect = variant.crop
    ? cropContentRect(variant.crop, variant.image, container)
    : contentRect(fit, variant.image, container, objectPosition);

  const surfaces = variant.surfaces.map((surface): SurfaceLayout => {
    const placement = placementOf(variant, surface.id);

    // Only a projected surface has a transform to describe. The rest are laid
    // out by the adapter, so reporting a quad for them would be fiction.
    if (placement !== 'projected' || !surface.reference) {
      return {
        id: surface.id,
        resolution: surface.resolution,
        clip: surface.clip,
        z: surface.z,
        matrix3d: '',
        quad: DEGENERATE_QUAD,
        scale: 0,
        placement,
        ok: placement === 'projected' ? false : surface.ok,
        issues: surface.issues,
      };
    }

    // Unit square -> image rect, in one scale and one translate.
    const scaled = scaleHomography(surface.reference, imageRect.width, imageRect.height);
    const placed = translateHomography(scaled, imageRect.x, imageRect.y);
    const quad = mapQuad(placed, rectToQuad(surface.resolution));

    return {
      id: surface.id,
      resolution: surface.resolution,
      clip: surface.clip,
      z: surface.z,
      matrix3d: toMatrix3d(placed),
      quad,
      scale: minEdgeScale(quad, surface.resolution),
      placement,
      ok: true,
      issues: surface.issues,
    };
  });

  return { imageRect, surfaces };
}

/**
 * The worst-case linear scale across the surface.
 *
 * Deliberately the minimum rather than an average: a surface at a grazing angle
 * is fine along one edge and crushed along the other, and it is the crushed edge
 * that decides whether text is readable and buttons are hittable.
 */
function minEdgeScale(quad: Quad, resolution: Size): number {
  const edges: readonly [Point, Point, number][] = [
    [quad[0], quad[1], resolution.width],
    [quad[3], quad[2], resolution.width],
    [quad[0], quad[3], resolution.height],
    [quad[1], quad[2], resolution.height],
  ];

  let smallest = Infinity;
  for (const [a, b, design] of edges) {
    if (design <= 0) continue;
    smallest = Math.min(smallest, Math.hypot(b[0] - a[0], b[1] - a[1]) / design);
  }
  return Number.isFinite(smallest) ? smallest : 0;
}

/**
 * Watch an element's size, calling back whenever it changes.
 *
 * Lives here so every adapter shares one implementation, but the module stays
 * usable in Node — the observer is only touched when the environment has one.
 */
export function observeSize(element: Element, onResize: (size: Size) => void): () => void {
  if (typeof ResizeObserver === 'undefined') {
    const rect = element.getBoundingClientRect();
    onResize({ width: rect.width, height: rect.height });
    return () => {};
  }

  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;
    const box = entry.contentRect;
    onResize({ width: box.width, height: box.height });
  });
  observer.observe(element);
  return () => observer.disconnect();
}
