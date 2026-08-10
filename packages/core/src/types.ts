/** A 2D point. */
export type Point = readonly [x: number, y: number];

/**
 * Four corners of a surface, always in the order top-left, top-right,
 * bottom-right, bottom-left as seen on the *unrotated design surface* — i.e. the
 * order in which they map onto (0,0), (W,0), (W,H), (0,H) of the design rect.
 */
export type Quad = readonly [Point, Point, Point, Point];

/**
 * The eight free coefficients of a projective transform, in the order
 * `[a, b, c, d, e, f, g, h]`, representing the 3x3 matrix
 *
 * ```
 * | a b c |
 * | d e f |
 * | g h 1 |
 * ```
 *
 * which maps `(u, v)` to
 * `x = (au + bv + c) / (gu + hv + 1)`, `y = (du + ev + f) / (gu + hv + 1)`.
 *
 * The bottom-right entry is normalised to 1, which is always possible for a
 * non-degenerate transform and is what makes eight (not nine) numbers enough.
 */
export type Homography = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
  g: number,
  h: number,
];

/** An axis-aligned rectangle. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A width/height pair. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The subset of CSS `object-fit` values that make sense for a photo backdrop. */
export type ObjectFit = 'contain' | 'cover' | 'fill';

/**
 * A region of the photo to show, as fractions of the intrinsic image size.
 *
 * Fractions rather than pixels for the same reason corners are: the manifest
 * survives re-exporting the photo at another size. `[0, 0, 1, 1]` is the whole
 * image, which is what `fit` alone already gives you.
 */
export type CropRect = readonly [x: number, y: number, width: number, height: number];

/**
 * What a variant does with one surface.
 *
 * `projected` is the point of the library. The others exist because a photograph
 * cannot be reflowed: below some size a projected surface is too small to read or
 * touch, and the honest options are to lay it out as ordinary content, float it
 * over the photo somewhere useful, or drop it.
 *
 * `rect` is in fractions of the *container*, not the image — a floating surface
 * is being placed on the screen rather than onto anything in the photo.
 */
export type SurfacePlacement =
  | 'projected'
  | 'flow'
  | 'none'
  | { readonly rect: CropRect };

/**
 * Camera pose of a surface, recovered from its homography.
 *
 * Angles are degrees and follow the rotation order `Ry(yaw) * Rx(pitch) * Rz(roll)`
 * — turn, then tilt, then spin. A surface facing the camera square-on is
 * `yaw = pitch = roll = 0`.
 */
export interface Pose {
  /** Rotation about the vertical axis. Positive turns the surface's right edge away. */
  readonly yaw: number;
  /** Rotation about the horizontal axis. Positive tips the surface's top away. */
  readonly pitch: number;
  /** Rotation in the surface plane. */
  readonly roll: number;
  /** Camera-space translation of the surface centre, in design-space units. */
  readonly translation: readonly [number, number, number];
}

/** Pinhole camera parameters used to recover and rebuild a {@link Pose}. */
export interface CameraModel {
  /** Focal length in the same pixel units as the homography's destination space. */
  readonly focalPx: number;
  /** Principal point (usually the image centre) in destination-space pixels. */
  readonly principal: Point;
}
