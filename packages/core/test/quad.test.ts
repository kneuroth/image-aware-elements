import { describe, expect, it } from 'vitest';
import { rectToQuad, solveHomography } from '../src/homography.js';
import { isConvex, isInFront, signedArea, validateQuad, winding } from '../src/quad.js';
import type { Quad, Size } from '../src/types.js';

const RESOLUTION: Size = { width: 1280, height: 800 };

const CONVEX: Quad = [
  [420, 310],
  [980, 255],
  [1050, 640],
  [380, 590],
];

/** Corners 2 and 3 swapped: the classic accidental drag, a self-intersecting bowtie. */
const BOWTIE: Quad = [
  [420, 310],
  [980, 255],
  [380, 590],
  [1050, 640],
];

/** A dart: corner 2 pushed inside the hull of the other three. */
const CONCAVE: Quad = [
  [100, 100],
  [600, 100],
  [350, 300],
  [100, 600],
];

const COLLINEAR: Quad = [
  [100, 100],
  [300, 100],
  [500, 100],
  [700, 100],
];

describe('validateQuad', () => {
  it('accepts a well-formed convex quad', () => {
    const result = validateQuad(CONVEX, RESOLUTION);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects a self-intersecting bowtie', () => {
    // This is the highest-value guard in the library. solveHomography returns a
    // perfectly finite, plausible-looking answer for a bowtie, so without this
    // the failure surfaces as silently garbled rendering rather than an error.
    expect(solveHomography(rectToQuad(RESOLUTION), BOWTIE)).not.toBeNull();
    expect(validateQuad(BOWTIE, RESOLUTION).issues).toContain('non-convex');
  });

  it('rejects a concave quad', () => {
    expect(validateQuad(CONCAVE, RESOLUTION).issues).toContain('non-convex');
  });

  it('rejects collinear corners', () => {
    expect(validateQuad(COLLINEAR, RESOLUTION).ok).toBe(false);
  });

  it('rejects non-finite coordinates', () => {
    const broken = [[0, 0], [Number.NaN, 0], [10, 10], [0, 10]] as unknown as Quad;
    expect(validateQuad(broken).issues).toEqual(['not-finite']);
  });

  it('works without a resolution, checking geometry only', () => {
    expect(validateQuad(CONVEX).ok).toBe(true);
    expect(validateQuad(BOWTIE).ok).toBe(false);
  });
});

describe('isConvex', () => {
  it('is independent of winding direction', () => {
    const reversed = [...CONVEX].reverse() as unknown as Quad;
    expect(isConvex(CONVEX)).toBe(true);
    expect(isConvex(reversed)).toBe(true);
  });

  it('is invariant under uniform scaling, so one check covers every container size', () => {
    for (const s of [0.001, 1, 1000]) {
      const scaled = CONVEX.map(([x, y]) => [x * s, y * s]) as unknown as Quad;
      expect(isConvex(scaled)).toBe(true);
    }
  });
});

describe('winding', () => {
  it('reports screen-space direction, where TL,TR,BR,BL reads clockwise', () => {
    expect(winding(CONVEX)).toBe('cw');
    expect(winding([...CONVEX].reverse() as unknown as Quad)).toBe('ccw');
    expect(winding(COLLINEAR)).toBe('degenerate');
  });

  it('signedArea magnitude matches the shoelace area', () => {
    const square: Quad = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(Math.abs(signedArea(square))).toBeCloseTo(100, 9);
  });
});

describe('isInFront', () => {
  it('accepts an ordinary perspective quad', () => {
    const h = solveHomography(rectToQuad(RESOLUTION), CONVEX)!;
    expect(isInFront(h, RESOLUTION)).toBe(true);
  });

  it('rejects a transform whose projective depth flips sign', () => {
    // g large enough that the denominator crosses zero inside the design rect.
    const h = [1, 0, 0, 0, 1, 0, -1 / 640, 0] as const;
    expect(isInFront(h, RESOLUTION)).toBe(false);
  });
});
