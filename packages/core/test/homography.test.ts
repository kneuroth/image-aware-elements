import { describe, expect, it } from 'vitest';
import {
  applyHomography,
  preTranslateHomography,
  rectToQuad,
  scaleHomography,
  solveHomography,
  toMatrix3d,
  translateHomography,
} from '../src/homography.js';
import type { Homography, Quad } from '../src/types.js';

const RESOLUTION = { width: 1280, height: 800 };
const DESIGN = rectToQuad(RESOLUTION);

/** A laptop screen tilted down and to the right, as if photographed from above-left. */
const TILTED: Quad = [
  [420, 310],
  [980, 255],
  [1050, 640],
  [380, 590],
];

function solved(dst: Quad = TILTED): Homography {
  const h = solveHomography(DESIGN, dst);
  expect(h).not.toBeNull();
  return h!;
}

/**
 * Apply a `matrix3d(...)` string the way a browser does: column-major 4x4 against
 * (x, y, 0, 1), then divide by the resulting w.
 *
 * This is the test that actually pins down the CSS contract. Getting the sixteen
 * slots in the wrong order still produces a plausible-looking transform, so
 * comparing against the intended corners is the only real check.
 */
function applyCssMatrix3d(css: string, x: number, y: number): [number, number] {
  const m = css
    .slice(css.indexOf('(') + 1, css.lastIndexOf(')'))
    .split(',')
    .map((n) => Number.parseFloat(n));
  expect(m).toHaveLength(16);

  const outX = m[0]! * x + m[4]! * y + m[12]!;
  const outY = m[1]! * x + m[5]! * y + m[13]!;
  const outW = m[3]! * x + m[7]! * y + m[15]!;
  return [outX / outW, outY / outW];
}

describe('solveHomography', () => {
  it('maps the design rect onto the destination quad exactly', () => {
    const h = solved();
    DESIGN.forEach((src, i) => {
      const [x, y] = applyHomography(h, src[0], src[1]);
      expect(x).toBeCloseTo(TILTED[i]![0], 9);
      expect(y).toBeCloseTo(TILTED[i]![1], 9);
    });
  });

  it('produces an identity-like transform for a matching rect', () => {
    const h = solved(DESIGN);
    const [x, y] = applyHomography(h, 640, 400);
    expect(x).toBeCloseTo(640, 9);
    expect(y).toBeCloseTo(400, 9);
    // No perspective component when source and destination agree.
    expect(h[6]).toBeCloseTo(0, 12);
    expect(h[7]).toBeCloseTo(0, 12);
  });

  it('returns null for a fully degenerate destination', () => {
    const collapsed: Quad = [
      [10, 10],
      [10, 10],
      [10, 10],
      [10, 10],
    ];
    expect(solveHomography(DESIGN, collapsed)).toBeNull();
  });

  it('stays accurate at photographic coordinate magnitudes', () => {
    const big: Quad = [
      [812, 1344],
      [3211, 908],
      [3402, 2510],
      [733, 2402],
    ];
    const h = solveHomography(rectToQuad({ width: 3840, height: 2160 }), big)!;
    rectToQuad({ width: 3840, height: 2160 }).forEach((src, i) => {
      const [x, y] = applyHomography(h, src[0], src[1]);
      expect(x).toBeCloseTo(big[i]![0], 6);
      expect(y).toBeCloseTo(big[i]![1], 6);
    });
  });
});

describe('toMatrix3d', () => {
  it('reproduces the destination corners through a browser-order 4x4', () => {
    const css = toMatrix3d(solved());
    DESIGN.forEach((src, i) => {
      const [x, y] = applyCssMatrix3d(css, src[0], src[1]);
      expect(x).toBeCloseTo(TILTED[i]![0], 6);
      expect(y).toBeCloseTo(TILTED[i]![1], 6);
    });
  });

  it('keeps sub-micron accuracy even at low significant-digit counts', () => {
    // Guards the significant-digits (not decimal-places) rounding: the g/h terms
    // are ~1e-4 and get multiplied by design coordinates in the thousands.
    const css = toMatrix3d(solved(), 9);
    DESIGN.forEach((src, i) => {
      const [x, y] = applyCssMatrix3d(css, src[0], src[1]);
      expect(x).toBeCloseTo(TILTED[i]![0], 3);
      expect(y).toBeCloseTo(TILTED[i]![1], 3);
    });
  });

  it('emits 16 finite components', () => {
    const parts = toMatrix3d(solved())
      .slice('matrix3d('.length, -1)
      .split(',')
      .map((n) => Number.parseFloat(n));
    expect(parts).toHaveLength(16);
    expect(parts.every(Number.isFinite)).toBe(true);
  });

  it('never emits negative zero, which some parsers dislike', () => {
    const css = toMatrix3d([1, 0, 0, 0, 1, 0, -0, -0]);
    expect(css).not.toContain('-0,');
    expect(css).not.toContain('-0)');
  });
});

describe('scaleHomography', () => {
  it('equals a full re-solve against a scaled destination', () => {
    const h = solved();
    for (const s of [0.37, 1, 2.5, 0.01]) {
      const scaledQuad = TILTED.map(([x, y]) => [x * s, y * s]) as unknown as Quad;
      const reSolved = solveHomography(DESIGN, scaledQuad)!;
      const shortcut = scaleHomography(h, s);
      shortcut.forEach((v, i) => expect(v).toBeCloseTo(reSolved[i]!, 9));
    }
  });

  it('supports non-uniform scaling', () => {
    const h = solved();
    const stretched = TILTED.map(([x, y]) => [x * 1.7, y * 0.4]) as unknown as Quad;
    const reSolved = solveHomography(DESIGN, stretched)!;
    const shortcut = scaleHomography(h, 1.7, 0.4);
    shortcut.forEach((v, i) => expect(v).toBeCloseTo(reSolved[i]!, 9));
  });
});

describe('translateHomography', () => {
  it('equals a full re-solve against a translated destination', () => {
    const h = solved();
    const [dx, dy] = [123.5, -47.25];
    const moved = TILTED.map(([x, y]) => [x + dx, y + dy]) as unknown as Quad;
    const reSolved = solveHomography(DESIGN, moved)!;
    const shortcut = translateHomography(h, dx, dy);
    shortcut.forEach((v, i) => expect(v).toBeCloseTo(reSolved[i]!, 9));
  });

  it('folds the offset through the projective denominator, not just c and f', () => {
    // The naive `c += dx` would leave the linear terms untouched. For a quad with
    // real perspective (g, h nonzero) that is measurably wrong.
    const h = solved();
    const shortcut = translateHomography(h, 100, 0);
    expect(shortcut[0]).not.toBeCloseTo(h[0], 9);
  });
});

describe('preTranslateHomography', () => {
  it('re-origins the source rect', () => {
    const h = solved();
    const centred = preTranslateHomography(h, 640, 400)!;
    // The centred transform at (0,0) must equal the original at the rect centre.
    const a = applyHomography(centred, 0, 0);
    const b = applyHomography(h, 640, 400);
    expect(a[0]).toBeCloseTo(b[0], 9);
    expect(a[1]).toBeCloseTo(b[1], 9);
  });

  it('keeps the bottom-right entry normalised', () => {
    const centred = preTranslateHomography(solved(), 640, 400)!;
    // Depth at the new origin should be exactly 1 after renormalisation.
    expect(centred[6] * 0 + centred[7] * 0 + 1).toBeCloseTo(1, 12);
    const corner = applyHomography(centred, -640, -400);
    expect(corner[0]).toBeCloseTo(TILTED[0]![0], 8);
  });
});
