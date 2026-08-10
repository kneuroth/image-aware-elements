import {
  composeQuad,
  decomposePose,
  defaultCamera,
  describeIssue,
  estimateResolution,
  rectToQuad,
  solveHomography,
  validateQuad,
  type CameraModel,
  type Point,
  type Pose,
  type Quad,
  type Size,
} from '@image-aware/core';
import type { CropRect } from '@image-aware/core';
import type { EditorImage, EditorSurface } from './state.js';

/** Normalised corners scaled up to intrinsic image pixels. */
export function toPixels(corners: Quad, image: Size): Quad {
  return corners.map(([x, y]) => [x * image.width, y * image.height] as Point) as unknown as Quad;
}

/** Image pixels back down to normalised corners. */
function toNormalised(corners: Quad, image: Size): Quad {
  return corners.map(([x, y]) => [x / image.width, y / image.height] as Point) as unknown as Quad;
}

function cameraFor(image: EditorImage): CameraModel {
  return defaultCamera(image);
}

function resolutionOf(surface: EditorSurface): Size {
  return { width: surface.resolution[0], height: surface.resolution[1] };
}

/**
 * The surface's orientation, recovered from its corners.
 *
 * Pose maths runs in intrinsic image pixels rather than the editor's on-screen
 * coordinates, so the readout does not change when you zoom or resize the window.
 */
export function poseOf(surface: EditorSurface, image: EditorImage): Pose | null {
  const resolution = resolutionOf(surface);
  const h = solveHomography(rectToQuad(resolution), toPixels(surface.corners, image));
  if (!h) return null;
  return decomposePose(h, resolution, cameraFor(image));
}

/**
 * Corners for a surface at a given pose.
 *
 * Because this projects a genuine rectangle in 3D, the result is always a valid
 * convex quad. That is what makes the angle sliders safe to drag: they cannot
 * produce a shape the renderer would choke on.
 */
export function cornersAtPose(
  pose: Pose,
  surface: EditorSurface,
  image: EditorImage,
): Quad | null {
  const quad = composeQuad(pose, resolutionOf(surface), cameraFor(image));
  return quad ? toNormalised(quad, image) : null;
}

export interface SurfaceCheck {
  readonly ok: boolean;
  readonly messages: readonly string[];
}

export function checkSurface(surface: EditorSurface): SurfaceCheck {
  const result = validateQuad(surface.corners, resolutionOf(surface));
  return { ok: result.ok, messages: result.issues.map(describeIssue) };
}

/**
 * How far the design rect's shape has drifted from the quad's, as a fraction.
 *
 * Content is laid out in the design rect and then projected onto the quad, so a
 * disagreement in aspect ratio is a stretch: a 1.5:1 design space on a 0.84:1
 * face squeezes everything to about half its proper width.
 */
export function aspectDrift(surface: EditorSurface, image: Size): number {
  const [width, height] = estimateResolution(surface.corners, image);
  if (width <= 0 || height <= 0) return 0;
  const design = surface.resolution[0] / surface.resolution[1];
  const actual = width / height;
  return Math.abs(design - actual) / actual;
}

/** Clamp a normalised point, allowing a little overhang past the image edge. */
export function clampNormalised([x, y]: Point, slack = 0.25): Point {
  return [clamp(x, -slack, 1 + slack), clamp(y, -slack, 1 + slack)];
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function replaceCorner(corners: Quad, index: number, point: Point): Quad {
  const next = [...corners] as Point[];
  next[index] = point;
  return next as unknown as Quad;
}

export const CORNER_NAMES = ['TL', 'TR', 'BR', 'BL'] as const;

/** Area of a simple polygon, by the shoelace formula. */
function polygonArea(points: readonly Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    total += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(total) / 2;
}

/** Sutherland-Hodgman clip of a convex polygon against one half-plane. */
function clipToEdge(
  points: readonly Point[],
  inside: (p: Point) => boolean,
  intersect: (a: Point, b: Point) => Point,
): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const current = points[i]!;
    const previous = points[(i + points.length - 1) % points.length]!;
    const currentIn = inside(current);
    const previousIn = inside(previous);

    if (currentIn) {
      if (!previousIn) out.push(intersect(previous, current));
      out.push(current);
    } else if (previousIn) {
      out.push(intersect(previous, current));
    }
  }
  return out;
}

/**
 * How much of a projected surface actually falls inside the frame, 0..1.
 *
 * Clipping properly rather than comparing bounding boxes, because the answer is
 * quoted to the user as a percentage and a quad at an angle has a bounding box
 * far larger than itself.
 */
export function visibleFraction(quad: Quad, container: Size): number {
  const full = polygonArea(quad);
  if (full <= 0) return 0;

  const lerp = (a: Point, b: Point, t: number): Point => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];

  let points: Point[] = [...quad];
  points = clipToEdge(points, (p) => p[0] >= 0, (a, b) => lerp(a, b, (0 - a[0]) / (b[0] - a[0])));
  points = clipToEdge(
    points,
    (p) => p[0] <= container.width,
    (a, b) => lerp(a, b, (container.width - a[0]) / (b[0] - a[0])),
  );
  points = clipToEdge(points, (p) => p[1] >= 0, (a, b) => lerp(a, b, (0 - a[1]) / (b[1] - a[1])));
  points = clipToEdge(
    points,
    (p) => p[1] <= container.height,
    (a, b) => lerp(a, b, (container.height - a[1]) / (b[1] - a[1])),
  );

  if (points.length < 3) return 0;
  return Math.min(1, polygonArea(points) / full);
}

/**
 * Grow a crop about its centre until its aspect ratio matches the container's.
 *
 * A crop is *covered* into the viewport, so anything narrower or shorter than the
 * container gets its excess axis cut off. A bounding box around the surfaces is
 * therefore not enough on its own: at a 390x844 phone, a squarish box loses its
 * sides. Expanding first is what makes "frame all surfaces" actually frame them.
 */
export function expandCropToAspect(crop: CropRect, image: Size, container: Size): CropRect {
  const [x, y, w, h] = crop;
  if (container.width <= 0 || container.height <= 0) return crop;

  const target = container.width / container.height;
  let widthPx = w * image.width;
  let heightPx = h * image.height;

  if (widthPx / heightPx < target) widthPx = heightPx * target;
  else heightPx = widthPx / target;

  const width = widthPx / image.width;
  const height = heightPx / image.height;

  return [x + (w - width) / 2, y + (h - height) / 2, width, height];
}

