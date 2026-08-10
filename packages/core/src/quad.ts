import { homographyDepth, solveHomography, rectToQuad } from './homography.js';
import type { Homography, Point, Quad, Size } from './types.js';

export type QuadIssue =
  /** A coordinate was NaN or infinite. */
  | 'not-finite'
  /** Three or more corners are collinear, or the quad has zero area. */
  | 'degenerate'
  /** Corners wind inconsistently: either a concave quad or a self-intersecting "bowtie". */
  | 'non-convex'
  /** The transform places part of the surface behind the camera; CSS renders this wildly. */
  | 'behind-camera';

export interface QuadValidation {
  readonly ok: boolean;
  readonly issues: readonly QuadIssue[];
}

/** Z component of the cross product of `o->a` and `o->b`. Sign gives turn direction. */
export function crossZ(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Signed area by the shoelace formula, in raw mathematical convention where the
 * y axis points up. Use {@link winding} if you want the answer in screen terms.
 */
export function signedArea(quad: Quad): number {
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const p = quad[i]!;
    const q = quad[(i + 1) % 4]!;
    total += p[0] * q[1] - q[0] * p[1];
  }
  return total / 2;
}

/**
 * Winding direction **as seen on screen**, where y grows downward.
 *
 * The sign is flipped relative to the raw shoelace area on purpose. Screen space
 * is y-down, so a positive mathematical area corresponds to a clockwise turn
 * visually — and the canonical corner order for this library (top-left,
 * top-right, bottom-right, bottom-left) is exactly that. Reporting it as `ccw`
 * would be technically defensible and practically misleading.
 */
export function winding(quad: Quad): 'cw' | 'ccw' | 'degenerate' {
  const area = signedArea(quad);
  if (Math.abs(area) < 1e-9) return 'degenerate';
  return area > 0 ? 'cw' : 'ccw';
}

/**
 * True when the four corners, taken in order, always turn the same way.
 *
 * This single test rejects both concave quads and self-intersecting "bowties",
 * which are the two ways a user can drag corners into something the solver will
 * happily accept but no browser will render sensibly.
 */
export function isConvex(quad: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const z = crossZ(quad[i]!, quad[(i + 1) % 4]!, quad[(i + 2) % 4]!);
    if (Math.abs(z) < 1e-9) return false;
    const s = Math.sign(z);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

/**
 * Check that a user-drawn quad can actually be rendered.
 *
 * Worth being explicit about why this exists: {@link solveHomography} returns a
 * perfectly finite answer for a bowtie quad. Without this guard the failure mode
 * is not an exception but silently garbled output, which is far harder to debug.
 */
export function validateQuad(quad: Quad, resolution?: Size): QuadValidation {
  const issues: QuadIssue[] = [];

  for (const [x, y] of quad) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, issues: ['not-finite'] };
    }
  }

  if (winding(quad) === 'degenerate') issues.push('degenerate');
  else if (!isConvex(quad)) issues.push('non-convex');

  if (issues.length === 0 && resolution) {
    const h = solveHomography(rectToQuad(resolution), quad);
    if (!h) issues.push('degenerate');
    else if (!isInFront(h, resolution)) issues.push('behind-camera');
  }

  return { ok: issues.length === 0, issues };
}

/**
 * True when every corner of the design rect has a positive projective depth.
 *
 * A negative denominator means that corner sits behind the camera plane. The
 * arithmetic still produces coordinates, but they are mirrored through infinity
 * and the surface tears apart on screen.
 */
export function isInFront(h: Homography, resolution: Size): boolean {
  for (const [u, v] of rectToQuad(resolution)) {
    if (homographyDepth(h, u, v) <= 0) return false;
  }
  return true;
}

/** Human-readable explanation for a validation issue. Used by the editor. */
export function describeIssue(issue: QuadIssue): string {
  switch (issue) {
    case 'not-finite':
      return 'A corner has an invalid coordinate.';
    case 'degenerate':
      return 'Corners are collinear or the shape has no area.';
    case 'non-convex':
      return 'Corners cross over each other. Drag them so the outline stays convex, in the order top-left, top-right, bottom-right, bottom-left.';
    case 'behind-camera':
      return 'Part of this surface projects behind the camera and cannot be rendered.';
  }
}
