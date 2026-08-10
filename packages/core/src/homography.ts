import type { Homography, Point, Quad, Size } from './types.js';

/**
 * Solve the projective transform that maps `src` onto `dst`, corner for corner.
 *
 * Each correspondence `(u,v) -> (x,y)` gives two linear equations once the
 * projective divide is cleared:
 *
 * ```
 *   au + bv + c - gux - hvx = x
 *   du + ev + f - guy - hvy = y
 * ```
 *
 * Four correspondences therefore pin down all eight unknowns exactly. This is a
 * plain 8x8 solve — no least-squares, no iteration.
 *
 * Returns `null` only when the system is singular. Note that a *non-convex* quad
 * is NOT singular: it yields a real but visually nonsensical transform. Callers
 * that accept user-drawn quads must run {@link validateQuad} first.
 */
export function solveHomography(src: Quad, dst: Quad): Homography | null {
  const a: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i]!;
    const [x, y] = dst[i]!;
    a.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    a.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }

  const n = 8;
  for (let i = 0; i < n; i++) {
    // Partial pivoting keeps this stable for the wide coordinate ranges that
    // come out of real photographs (thousands of pixels) mixed with the tiny
    // g/h terms (order 1e-4).
    let pivot = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(a[r]![i]!) > Math.abs(a[pivot]![i]!)) pivot = r;
    }
    if (Math.abs(a[pivot]![i]!) < 1e-12) return null;

    const tmpRow = a[i]!;
    a[i] = a[pivot]!;
    a[pivot] = tmpRow;
    const tmpVal = b[i]!;
    b[i] = b[pivot]!;
    b[pivot] = tmpVal;

    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = a[r]![i]! / a[i]![i]!;
      if (factor === 0) continue;
      for (let c = i; c < n; c++) a[r]![c]! -= factor * a[i]![c]!;
      b[r]! -= factor * b[i]!;
    }
  }

  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const value = b[i]! / a[i]![i]!;
    if (!Number.isFinite(value)) return null;
    out[i] = value;
  }
  return out as unknown as Homography;
}

/** Map a single point through a homography. */
export function applyHomography(h: Homography, u: number, v: number): Point {
  const w = h[6] * u + h[7] * v + 1;
  return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
}

/** The projective denominator at `(u,v)`. Non-positive means "behind the camera". */
export function homographyDepth(h: Homography, u: number, v: number): number {
  return h[6] * u + h[7] * v + 1;
}

/** Map all four corners of a quad through a homography. */
export function mapQuad(h: Homography, quad: Quad): Quad {
  return [
    applyHomography(h, quad[0][0], quad[0][1]),
    applyHomography(h, quad[1][0], quad[1][1]),
    applyHomography(h, quad[2][0], quad[2][1]),
    applyHomography(h, quad[3][0], quad[3][1]),
  ];
}

/**
 * Scale the transform's *output*. Because scaling `(x, y)` scales the numerators
 * but leaves the projective denominator alone, this touches only six of the eight
 * coefficients — no re-solve.
 *
 * This is what makes responsive resizing O(1): solve once against a unit
 * destination, then scale to whatever size the container happens to be.
 */
export function scaleHomography(h: Homography, sx: number, sy: number = sx): Homography {
  return [h[0] * sx, h[1] * sx, h[2] * sx, h[3] * sy, h[4] * sy, h[5] * sy, h[6], h[7]];
}

/**
 * Translate the transform's *output* by `(dx, dy)`.
 *
 * Adding a constant in projective space is not simply `c += dx`: the offset has
 * to be folded through the denominator, so the linear terms pick it up too.
 *
 * ```
 *   x + dx = (au + bv + c) / w + dx = ((a + dx*g)u + (b + dx*h)v + (c + dx)) / w
 * ```
 */
export function translateHomography(h: Homography, dx: number, dy: number): Homography {
  return [
    h[0] + dx * h[6],
    h[1] + dx * h[7],
    h[2] + dx,
    h[3] + dy * h[6],
    h[4] + dy * h[7],
    h[5] + dy,
    h[6],
    h[7],
  ];
}

/**
 * Translate the transform's *input* by `(tx, ty)`, i.e. re-origin the source
 * rectangle. Composing on the source side changes the projective denominator's
 * constant term, so the whole matrix is renormalised to keep the bottom-right
 * entry at 1.
 */
export function preTranslateHomography(h: Homography, tx: number, ty: number): Homography | null {
  const k = h[6] * tx + h[7] * ty + 1;
  if (Math.abs(k) < 1e-12) return null;
  return [
    h[0] / k,
    h[1] / k,
    (h[0] * tx + h[1] * ty + h[2]) / k,
    h[3] / k,
    h[4] / k,
    (h[3] * tx + h[4] * ty + h[5]) / k,
    h[6] / k,
    h[7] / k,
  ];
}

/**
 * Render a homography as a CSS `matrix3d()`.
 *
 * CSS matrices are **column-major**, and transform `(x, y, z, 1)` with a
 * perspective divide by the resulting `w`. Laying the eight coefficients into the
 * right slots leaves z untouched and reproduces the 2D projective map exactly:
 *
 * ```
 * matrix3d(a, d, 0, g,
 *          b, e, 0, h,
 *          0, 0, 1, 0,
 *          c, f, 0, 1)
 * ```
 *
 * The element this is applied to MUST have `transform-origin: 0 0`, and MUST NOT
 * sit inside a CSS `perspective` — the divide is already baked in here, and a
 * parent `perspective` would apply it a second time.
 */
export function toMatrix3d(h: Homography, significantDigits = 12): string {
  const [a, b, c, d, e, f, g, hh] = h;
  const m = [a, d, 0, g, b, e, 0, hh, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map((n) => format(n, significantDigits)).join(', ')})`;
}

/**
 * Serialise a coefficient to a fixed number of *significant digits*.
 *
 * Rounding to decimal places instead would be a real bug: the translation terms
 * run to hundreds while the perspective terms sit around 1e-4, so a fixed number
 * of decimals leaves the perspective terms with only a handful of significant
 * figures. That error is then multiplied by the design-space coordinate (often
 * >1000) inside the projective denominator, visibly shifting far corners.
 */
function format(n: number, significantDigits: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n === 0) return '0';
  const v = Number(n.toPrecision(significantDigits));
  return Object.is(v, -0) ? '0' : String(v);
}

/** The design rectangle `(0,0) (W,0) (W,H) (0,H)` as a quad. */
export function rectToQuad(size: Size): Quad {
  return [
    [0, 0],
    [size.width, 0],
    [size.width, size.height],
    [0, size.height],
  ];
}
