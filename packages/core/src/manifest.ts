import type { CropRect, ObjectFit, Point, Quad, Size, SurfacePlacement } from './types.js';

export const MANIFEST_VERSION = 1;

export interface ManifestImage {
  /** Path or URL of the photo, relative to the manifest unless absolute. */
  readonly src: string;
  /** Intrinsic pixel dimensions of the photo. */
  readonly width: number;
  readonly height: number;
}

export interface ManifestCamera {
  /** Focal length in image pixels. Only affects the yaw/pitch/roll readout. */
  readonly focalPx: number;
}

export interface ManifestSurface {
  /** Slot name used to target this surface from markup. */
  readonly id: string;
  /** Human label shown in the editor. */
  readonly label?: string;
  /**
   * Corners normalised to 0..1 against the intrinsic image size, in the order
   * top-left, top-right, bottom-right, bottom-left of the design rect.
   *
   * Normalised rather than absolute so the manifest survives re-exporting the
   * photo at a different resolution.
   */
  readonly corners: Quad;
  /** Design-space CSS pixel size that slotted content lays out against. */
  readonly resolution: readonly [number, number];
  /** Clip content to the surface bounds. Defaults to true. */
  readonly clip?: boolean;
  /** Paint order among surfaces. Defaults to 0. */
  readonly z?: number;
  /** Cached orientation readout. Informational only — corners always win. */
  readonly pose?: { readonly yaw: number; readonly pitch: number; readonly roll: number };
}

/**
 * One art-directed rendering of the scene, gated on a media query.
 *
 * A photograph is a fixed projection: the surfaces inside it are wherever the
 * camera put them. Nothing can make a landscape crop hold a legible menu on a
 * phone, so responsiveness here is art direction rather than reflow — the same
 * problem `<picture>` solves, and the same shape of answer.
 *
 * Two kinds of variant are useful, and the common one costs nothing:
 *
 * - Same photo, different framing: override `fit`/`objectPosition` only. Corners
 *   are fractions of the image, so they carry over untouched.
 * - A different crop or shot: bring an `image` *and* the `surfaces` marked
 *   against it, because the fractions differ.
 *
 * Named `variants` rather than `sources` because {@link ManifestSource} already
 * means "something you can pass as a manifest".
 */
export interface ManifestVariant {
  /**
   * CSS media query gating this variant. Absent means it always matches, which
   * makes it a default — put those last, since the first match wins.
   */
  readonly media?: string;
  readonly image: ManifestImage;
  readonly surfaces: readonly ManifestSurface[];
  readonly fit?: ObjectFit;
  /** As CSS `object-position`, e.g. `"78% 50%"`. */
  readonly objectPosition?: string;
  /**
   * Show this region of the photo, as fractions of the image. Takes precedence
   * over `fit`/`objectPosition`, which can pan but cannot zoom.
   */
  readonly crop?: CropRect;
  /**
   * Stop projecting and let slotted content lay out as ordinary blocks. The
   * honest answer on a phone, where a surface is too small to touch. Shorthand
   * for giving every surface a `flow` placement.
   */
  readonly flat?: boolean;
  /** Per-surface overrides, keyed by surface id. Anything absent stays projected. */
  readonly placements?: Readonly<Record<string, SurfacePlacement>>;
}

export interface Manifest {
  readonly version: number;
  readonly image: ManifestImage;
  readonly camera?: ManifestCamera;
  readonly surfaces: readonly ManifestSurface[];
  /** Default object-fit for the photo. Consumers may override. */
  readonly fit?: ObjectFit;
  /** Default region of the photo to show. Wins over fit, and variants inherit it. */
  readonly crop?: CropRect;
  /** Default per-surface placements. Variants inherit these unless they override. */
  readonly placements?: Readonly<Record<string, SurfacePlacement>>;
  /**
   * Always populated by {@link parseManifest}: any declared variants in order,
   * followed by an unconditional one built from the top-level image and surfaces,
   * so selection cannot come up empty.
   *
   * Optional only so a hand-written `Manifest` literal stays cheap to build —
   * {@link prepareManifest} synthesises the default when it is absent.
   */
  readonly variants?: readonly ManifestVariant[];
}

/**
 * The shape a raw JSON import has before validation.
 *
 * `import manifest from './desk.surfaces.json'` gives TypeScript `number[][]` for
 * corners, not the 4-tuple {@link Manifest} requires, so a validated `Manifest` is
 * not what callers actually hold at the point of use. Accepting this looser shape
 * lets a JSON import be passed straight in without a cast — {@link parseManifest}
 * does the narrowing at runtime, which is where it belongs.
 */
export interface ManifestInput {
  readonly version: number;
  readonly image: { readonly src: string; readonly width: number; readonly height: number };
  readonly surfaces: readonly ManifestSurfaceInput[];
  readonly camera?: { readonly focalPx: number };
  readonly fit?: string;
  readonly crop?: readonly number[];
  readonly placements?: Readonly<Record<string, unknown>>;
  readonly variants?: readonly {
    readonly media?: string;
    readonly image?: { readonly src: string; readonly width: number; readonly height: number };
    readonly surfaces?: readonly ManifestSurfaceInput[];
    readonly fit?: string;
    readonly objectPosition?: string;
    readonly crop?: readonly number[];
    readonly flat?: boolean;
    readonly placements?: Readonly<Record<string, unknown>>;
  }[];
}

interface ManifestSurfaceInput {
  readonly id: string;
  readonly label?: string;
  readonly corners: readonly (readonly number[])[];
  readonly resolution?: readonly number[];
  readonly clip?: boolean;
  readonly z?: number;
  readonly pose?: { readonly yaw: number; readonly pitch: number; readonly roll: number };
}

/** Anything usable as a manifest: a validated object, a raw JSON import, or a URL. */
export type ManifestSource = Manifest | ManifestInput | string;

export class ManifestError extends Error {
  override readonly name = 'ManifestError';
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} (at ${path})`);
  }
}

/**
 * Validate and normalise an untrusted manifest object.
 *
 * Hand-rolled rather than schema-library-backed so `@image-aware/core` keeps its
 * zero-dependency promise — this is the only place validation is needed and the
 * shape is small.
 */
export function parseManifest(input: unknown): Manifest {
  const root = requireObject(input, 'manifest');

  const version = root['version'];
  if (typeof version !== 'number') throw new ManifestError('Expected a numeric version', 'version');
  if (version > MANIFEST_VERSION) {
    throw new ManifestError(
      `Manifest version ${version} is newer than this library supports (${MANIFEST_VERSION}). Upgrade @image-aware/core.`,
      'version',
    );
  }

  const image = parseImage(root['image'], 'image');

  let camera: ManifestCamera | undefined;
  if (root['camera'] !== undefined) {
    const raw = requireObject(root['camera'], 'camera');
    camera = { focalPx: requirePositive(raw['focalPx'], 'camera.focalPx') };
  }

  const surfaces = parseSurfaces(root['surfaces'], 'surfaces', image);
  const fit = parseFit(root['fit']);
  const crop = root['crop'] === undefined ? undefined : requireCrop(root['crop'], 'crop');
  const placements = parsePlacements(root['placements'], 'placements');
  const variants = parseVariants(root['variants'], { image, surfaces, fit, crop, placements });

  return {
    version: MANIFEST_VERSION,
    image,
    ...(camera ? { camera } : {}),
    surfaces,
    ...(fit ? { fit } : {}),
    ...(crop ? { crop } : {}),
    ...(placements ? { placements } : {}),
    // The top level is always the last resort, so selection cannot come up empty.
    variants: [
      ...variants,
      {
        image,
        surfaces,
        ...(fit ? { fit } : {}),
        ...(crop ? { crop } : {}),
        ...(placements ? { placements } : {}),
      },
    ],
  };
}

function parseImage(value: unknown, path: string): ManifestImage {
  const raw = requireObject(value, path);
  const src = raw['src'];
  if (typeof src !== 'string' || src.length === 0) {
    throw new ManifestError('Expected a non-empty image src', `${path}.src`);
  }
  return {
    src,
    width: requirePositive(raw['width'], `${path}.width`),
    height: requirePositive(raw['height'], `${path}.height`),
  };
}

function parseFit(value: unknown): ObjectFit | undefined {
  return value === 'contain' || value === 'cover' || value === 'fill' ? value : undefined;
}

function parseSurfaces(value: unknown, path: string, image: Size): readonly ManifestSurface[] {
  if (!Array.isArray(value)) {
    throw new ManifestError('Expected surfaces to be an array', path);
  }

  const seen = new Set<string>();
  return value.map((entry, i) => {
    const itemPath = `${path}[${i}]`;
    const raw = requireObject(entry, itemPath);

    const id = raw['id'];
    if (typeof id !== 'string' || id.length === 0) {
      throw new ManifestError('Expected a non-empty surface id', `${itemPath}.id`);
    }
    if (seen.has(id)) {
      throw new ManifestError(`Duplicate surface id "${id}"`, `${itemPath}.id`);
    }
    seen.add(id);

    const corners = requireQuad(raw['corners'], `${itemPath}.corners`);
    const resolution = raw['resolution'] === undefined
      ? estimateResolution(corners, image)
      : requireResolution(raw['resolution'], `${itemPath}.resolution`);

    const surface: ManifestSurface = {
      id,
      corners,
      resolution,
      ...(typeof raw['label'] === 'string' ? { label: raw['label'] } : {}),
      clip: raw['clip'] === undefined ? true : Boolean(raw['clip']),
      z: typeof raw['z'] === 'number' ? raw['z'] : 0,
      ...(isPose(raw['pose']) ? { pose: raw['pose'] } : {}),
    };
    return surface;
  });
}

/**
 * Parse the declared variants, resolving each against the top-level defaults so
 * that everything downstream sees a complete scene rather than a patch.
 */
function parseVariants(
  value: unknown,
  base: {
    image: ManifestImage;
    surfaces: readonly ManifestSurface[];
    fit: ObjectFit | undefined;
    crop: CropRect | undefined;
    placements: Record<string, SurfacePlacement> | undefined;
  },
): readonly ManifestVariant[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ManifestError('Expected variants to be an array', 'variants');
  }

  return value.map((entry, i) => {
    const path = `variants[${i}]`;
    const raw = requireObject(entry, path);

    const media = raw['media'];
    if (media !== undefined && (typeof media !== 'string' || media.trim().length === 0)) {
      throw new ManifestError('Expected a non-empty media query', `${path}.media`);
    }

    const hasImage = raw['image'] !== undefined;
    const hasSurfaces = raw['surfaces'] !== undefined;

    // Corners are fractions of *their* image. Reusing them against a differently
    // shaped photo silently drifts every surface, so refuse rather than guess.
    if (hasImage && !hasSurfaces) {
      throw new ManifestError(
        'A variant that overrides image must also provide the surfaces marked against it',
        `${path}.surfaces`,
      );
    }

    const image = hasImage ? parseImage(raw['image'], `${path}.image`) : base.image;
    const surfaces = hasSurfaces
      ? parseSurfaces(raw['surfaces'], `${path}.surfaces`, image)
      : base.surfaces;

    const objectPosition = raw['objectPosition'];
    if (objectPosition !== undefined && typeof objectPosition !== 'string') {
      throw new ManifestError('Expected objectPosition to be a string', `${path}.objectPosition`);
    }

    const fit = parseFit(raw['fit']) ?? base.fit;
    const crop =
      raw['crop'] === undefined ? base.crop : requireCrop(raw['crop'], `${path}.crop`);
    const placements = parsePlacements(raw['placements'], `${path}.placements`) ?? base.placements;

    return {
      ...(typeof media === 'string' ? { media } : {}),
      image,
      surfaces,
      ...(fit ? { fit } : {}),
      ...(objectPosition !== undefined ? { objectPosition } : {}),
      ...(crop ? { crop } : {}),
      ...(raw['flat'] !== undefined ? { flat: Boolean(raw['flat']) } : {}),
      ...(placements ? { placements } : {}),
    };
  });
}

function requireCrop(value: unknown, path: string): CropRect {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new ManifestError('Expected [x, y, width, height]', path);
  }
  const numbers = value.map((entry, i) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new ManifestError('Expected a finite number', `${path}[${i}]`);
    }
    return entry;
  });
  // A zero or negative extent has no sensible rendering, and silently falling
  // back to the whole image would hide the mistake until someone looked.
  if (!(numbers[2]! > 0) || !(numbers[3]! > 0)) {
    throw new ManifestError('Expected a positive crop width and height', path);
  }
  return numbers as unknown as CropRect;
}

function parsePlacements(
  value: unknown,
  path: string,
): Record<string, SurfacePlacement> | undefined {
  if (value === undefined) return undefined;
  const raw = requireObject(value, path);

  const out: Record<string, SurfacePlacement> = {};
  for (const [id, entry] of Object.entries(raw)) {
    const entryPath = `${path}.${id}`;
    if (entry === 'projected' || entry === 'flow' || entry === 'none') {
      out[id] = entry;
      continue;
    }
    const object = requireObject(entry, entryPath);
    if (object['rect'] === undefined) {
      throw new ManifestError(
        'Expected "projected", "flow", "none", or an object with a rect',
        entryPath,
      );
    }
    out[id] = { rect: requireCrop(object['rect'], `${entryPath}.rect`) };
  }
  return out;
}

/** Parse a manifest from JSON text, adding position info to syntax errors. */
export function parseManifestJson(text: string): Manifest {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new ManifestError(
      `Invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      'manifest',
    );
  }
  return parseManifest(data);
}

/**
 * Guess a sensible design resolution from the quad's own size in the photo.
 *
 * Averaging opposite edges gives roughly 1:1 texel density — content is authored
 * at about the pixel size the surface actually occupies in the source image.
 */
export function estimateResolution(corners: Quad, image: Size): readonly [number, number] {
  const px = corners.map(([x, y]) => [x * image.width, y * image.height] as Point);
  const top = distance(px[0]!, px[1]!);
  const bottom = distance(px[3]!, px[2]!);
  const left = distance(px[0]!, px[3]!);
  const right = distance(px[1]!, px[2]!);
  return [Math.max(1, Math.round((top + bottom) / 2)), Math.max(1, Math.round((left + right) / 2))];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ManifestError('Expected an object', path);
  }
  return value as Record<string, unknown>;
}

function requirePositive(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ManifestError('Expected a positive number', path);
  }
  return value;
}

function requireQuad(value: unknown, path: string): Quad {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new ManifestError('Expected exactly 4 corners', path);
  }
  const points = value.map((point, i) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new ManifestError('Expected an [x, y] pair', `${path}[${i}]`);
    }
    const [x, y] = point as unknown[];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new ManifestError('Expected finite numeric coordinates', `${path}[${i}]`);
    }
    return [x, y] as Point;
  });
  return points as unknown as Quad;
}

function requireResolution(value: unknown, path: string): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new ManifestError('Expected [width, height]', path);
  }
  return [requirePositive(value[0], `${path}[0]`), requirePositive(value[1], `${path}[1]`)];
}

function isPose(value: unknown): value is { yaw: number; pitch: number; roll: number } {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return typeof p['yaw'] === 'number' && typeof p['pitch'] === 'number' && typeof p['roll'] === 'number';
}
