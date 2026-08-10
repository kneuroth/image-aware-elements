import { describe, expect, it } from 'vitest';
import { computeLayout, prepareManifest, type PreparedVariant } from '../src/layout.js';
import { parseManifest, type Manifest } from '../src/manifest.js';
import type { Quad } from '../src/types.js';

const CORNERS: Quad = [
  [0.2, 0.25],
  [0.7, 0.2],
  [0.75, 0.65],
  [0.25, 0.6],
];

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return parseManifest({
    version: 1,
    image: { src: 'laptop.jpg', width: 4000, height: 2000 },
    surfaces: [{ id: 'screen', corners: CORNERS, resolution: [1280, 800] }],
    ...overrides,
  });
}

/**
 * Prepare and take the first variant — for a manifest that declares none, that is
 * the unconditional one built from the top level, i.e. what always renders.
 */
function prepare(source: Manifest): PreparedVariant {
  return prepareManifest(source).variants[0]!;
}

/** Apply a matrix3d string the way a browser does. */
function applyCss(css: string, x: number, y: number): [number, number] {
  const m = css
    .slice(css.indexOf('(') + 1, -1)
    .split(',')
    .map(Number);
  const w = m[3]! * x + m[7]! * y + m[15]!;
  return [(m[0]! * x + m[4]! * y + m[12]!) / w, (m[1]! * x + m[5]! * y + m[13]!) / w];
}

describe('computeLayout', () => {
  it('lands the design rect on the marked corners, in container pixels', () => {
    const prepared = prepare(manifest());
    // 2:1 container matches the image aspect, so contain fills it exactly.
    const layout = computeLayout(prepared, { width: 800, height: 400 }, 'contain');
    const surface = layout.surfaces[0]!;

    const design: Quad = [
      [0, 0],
      [1280, 0],
      [1280, 800],
      [0, 800],
    ];
    design.forEach((corner, i) => {
      const [x, y] = applyCss(surface.matrix3d, corner[0], corner[1]);
      expect(x).toBeCloseTo(CORNERS[i]![0] * 800, 5);
      expect(y).toBeCloseTo(CORNERS[i]![1] * 400, 5);
    });
  });

  it('tracks the image rect rather than the container under fit=cover', () => {
    const prepared = prepare(manifest());
    const container = { width: 800, height: 800 };
    const layout = computeLayout(prepared, container, 'cover');
    const rect = layout.imageRect;

    expect(rect.width).toBeCloseTo(1600, 9);
    expect(rect.x).toBeCloseTo(-400, 9);

    const [x, y] = applyCss(layout.surfaces[0]!.matrix3d, 0, 0);
    // Top-left corner must sit relative to the overflowing photo, not the box.
    expect(x).toBeCloseTo(rect.x + CORNERS[0]![0] * rect.width, 5);
    expect(y).toBeCloseTo(rect.y + CORNERS[0]![1] * rect.height, 5);
  });

  it('produces geometrically consistent output across container sizes', () => {
    const prepared = prepare(manifest());
    for (const size of [
      { width: 200, height: 100 },
      { width: 1920, height: 960 },
      { width: 640, height: 320 },
    ]) {
      const layout = computeLayout(prepared, size, 'contain');
      const [x, y] = applyCss(layout.surfaces[0]!.matrix3d, 1280, 800);
      expect(x / size.width).toBeCloseTo(CORNERS[2]![0], 6);
      expect(y / size.height).toBeCloseTo(CORNERS[2]![1], 6);
    }
  });

  it('flags an invalid surface instead of emitting a garbled transform', () => {
    const bowtie: Quad = [
      [0.2, 0.25],
      [0.7, 0.2],
      [0.25, 0.6],
      [0.75, 0.65],
    ];
    const prepared = prepare(
      manifest({ surfaces: [{ id: 'screen', corners: bowtie, resolution: [1280, 800] }] }),
    );
    const surface = computeLayout(prepared, { width: 800, height: 400 }).surfaces[0]!;

    expect(surface.ok).toBe(false);
    expect(surface.issues).toContain('non-convex');
    expect(surface.matrix3d).toBe('');
  });

  it('carries multiple surfaces through independently', () => {
    const prepared = prepare(
      manifest({
        surfaces: [
          { id: 'screen', corners: CORNERS, resolution: [1280, 800], z: 2 },
          {
            id: 'phone',
            corners: [
              [0.05, 0.7],
              [0.15, 0.68],
              [0.16, 0.95],
              [0.06, 0.97],
            ],
            resolution: [390, 844],
            z: 1,
          },
        ],
      }),
    );
    const layout = computeLayout(prepared, { width: 800, height: 400 });

    expect(layout.surfaces).toHaveLength(2);
    expect(layout.surfaces.map((s) => s.id)).toEqual(['screen', 'phone']);
    expect(layout.surfaces.every((s) => s.ok)).toBe(true);
    expect(layout.surfaces[0]!.matrix3d).not.toBe(layout.surfaces[1]!.matrix3d);
    expect(layout.surfaces[1]!.z).toBe(1);
  });

  it('degrades to a zero-size layout without throwing', () => {
    const prepared = prepare(manifest());
    expect(() => computeLayout(prepared, { width: 0, height: 0 })).not.toThrow();
  });
});

/**
 * These exist for the responsive story: whether a projected control is legible
 * and tappable is a question about its size *on screen*, which the transform
 * alone does not answer.
 */
describe('surface diagnostics', () => {
  /** Axis-aligned, so its projected edges are trivially predictable. */
  const RECT: Quad = [
    [0.1, 0.1],
    [0.6, 0.1],
    [0.6, 0.6],
    [0.1, 0.6],
  ];

  const square = (resolution: [number, number]) =>
    manifest({ surfaces: [{ id: 'screen', corners: RECT, resolution }] });

  const edge = (a: readonly [number, number], b: readonly [number, number]) =>
    Math.hypot(b[0] - a[0], b[1] - a[1]);

  it('reports where the corners actually land, in container pixels', () => {
    const surface = computeLayout(prepare(manifest()), { width: 800, height: 400 }, 'contain')
      .surfaces[0]!;

    surface.quad.forEach((point, i) => {
      expect(point[0]).toBeCloseTo(CORNERS[i]![0] * 800, 5);
      expect(point[1]).toBeCloseTo(CORNERS[i]![1] * 400, 5);
    });
  });

  it('scores scale 1 when a surface renders at exactly its design size', () => {
    // The photo is 2:1 and so is the container, so `contain` fills it exactly and
    // the quad covers half of each axis: 400 x 200 css px.
    const surface = computeLayout(prepare(square([400, 200])), { width: 800, height: 400 })
      .surfaces[0]!;
    expect(surface.scale).toBeCloseTo(1, 6);
  });

  it('halves when the container halves, because design px shrink with it', () => {
    const surface = computeLayout(prepare(square([400, 200])), { width: 400, height: 200 })
      .surfaces[0]!;
    expect(surface.scale).toBeCloseTo(0.5, 6);
  });

  it('takes the worst edge rather than an average, on a foreshortened quad', () => {
    const surface = computeLayout(prepare(manifest()), { width: 800, height: 400 }).surfaces[0]!;
    const { quad } = surface;
    const ratios = [
      edge(quad[0], quad[1]) / 1280,
      edge(quad[3], quad[2]) / 1280,
      edge(quad[0], quad[3]) / 800,
      edge(quad[1], quad[2]) / 800,
    ];

    expect(surface.scale).toBeCloseTo(Math.min(...ratios), 9);
    // A surface at an angle has edges of different lengths; reporting the mean
    // would flatter the crushed one, which is the one that decides legibility.
    expect(surface.scale).toBeLessThan(Math.max(...ratios));
  });

  it('reports zero scale for a surface it refuses to render', () => {
    const bowtie: Quad = [
      [0.2, 0.25],
      [0.7, 0.2],
      [0.25, 0.6],
      [0.75, 0.65],
    ];
    const surface = computeLayout(
      prepare(manifest({ surfaces: [{ id: 'screen', corners: bowtie, resolution: [1280, 800] }] })),
      { width: 800, height: 400 },
    ).surfaces[0]!;

    expect(surface.ok).toBe(false);
    expect(surface.scale).toBe(0);
    expect(surface.quad.every(([x, y]) => x === 0 && y === 0)).toBe(true);
  });
});

describe('crop framing', () => {
  /** A 1600x1000 photo, so the arithmetic below stays readable. */
  const cropped = (crop: readonly number[]): PreparedVariant =>
    prepareManifest(
      parseManifest({
        version: 1,
        image: { src: 'desk.jpg', width: 1600, height: 1000 },
        surfaces: [{ id: 'screen', corners: CORNERS, resolution: [1280, 800] }],
        variants: [{ crop }],
      }),
    ).variants[0]!;

  it('fills the container with the requested region of the photo', () => {
    // The right half of a 1600x1000 photo is 800x1000, and an 800x1000 container
    // takes it at 1:1 — so the photo is painted at natural size, shifted left.
    const variant = cropped([0.5, 0, 0.5, 1]);
    const layout = computeLayout(variant, { width: 800, height: 1000 });

    expect(layout.imageRect.width).toBeCloseTo(1600, 6);
    expect(layout.imageRect.x).toBeCloseTo(-800, 6);
    expect(layout.imageRect.y).toBeCloseTo(0, 6);
  });

  it('zooms rather than merely panning, which fit cannot do', () => {
    // A quarter-width crop must be magnified 4x to fill the same box. This is the
    // whole reason crop exists: object-position slides, it does not magnify.
    const variant = cropped([0.25, 0.25, 0.25, 0.25]);
    const layout = computeLayout(variant, { width: 800, height: 500 });

    expect(layout.imageRect.width).toBeCloseTo(3200, 6);
    // The crop's centre sits at the container's centre.
    expect(layout.imageRect.x + 0.375 * layout.imageRect.width).toBeCloseTo(400, 6);
    expect(layout.imageRect.y + 0.375 * layout.imageRect.height).toBeCloseTo(250, 6);
  });

  it('keeps surfaces glued to the photo through a crop', () => {
    const variant = cropped([0.2, 0.1, 0.6, 0.8]);
    const layout = computeLayout(variant, { width: 800, height: 500 });
    const { imageRect } = layout;

    // Same relationship as every other framing: corner = imageRect + fraction.
    const [x, y] = layout.surfaces[0]!.quad[0]!;
    expect(x).toBeCloseTo(imageRect.x + CORNERS[0]![0] * imageRect.width, 5);
    expect(y).toBeCloseTo(imageRect.y + CORNERS[0]![1] * imageRect.height, 5);
  });

  it('takes precedence over fit and object-position', () => {
    const layout = computeLayout(cropped([0.5, 0, 0.5, 1]), { width: 800, height: 1000 }, 'contain', [0, 0]);
    expect(layout.imageRect.x).toBeCloseTo(-800, 6);
  });
});

describe('surface placement', () => {
  const withPlacements = (placements: Record<string, unknown>) =>
    prepare(manifest({ variants: [{ placements }] } as never));

  it('projects by default', () => {
    const surface = computeLayout(prepare(manifest()), { width: 800, height: 400 }).surfaces[0]!;
    expect(surface.placement).toBe('projected');
    expect(surface.matrix3d).toMatch(/^matrix3d\(/);
  });

  it('reports an unprojected surface without inventing a transform for it', () => {
    const surface = computeLayout(withPlacements({ screen: 'flow' }), {
      width: 800,
      height: 400,
    }).surfaces[0]!;

    expect(surface.placement).toBe('flow');
    expect(surface.matrix3d).toBe('');
    expect(surface.scale).toBe(0);
    // Still a fine surface — it is simply not being projected.
    expect(surface.ok).toBe(true);
  });

  it('carries a floating rect through to the layout', () => {
    const surface = computeLayout(withPlacements({ screen: { rect: [0.05, 0.6, 0.9, 0.3] } }), {
      width: 800,
      height: 400,
    }).surfaces[0]!;

    expect(surface.placement).toEqual({ rect: [0.05, 0.6, 0.9, 0.3] });
  });

  it('treats flat as "every surface flows", with explicit placements winning', () => {
    const variant = prepare(
      manifest({ variants: [{ flat: true, placements: { screen: 'projected' } }] } as never),
    );
    expect(computeLayout(variant, { width: 800, height: 400 }).surfaces[0]!.placement).toBe(
      'projected',
    );

    const allFlow = prepare(manifest({ variants: [{ flat: true }] } as never));
    expect(computeLayout(allFlow, { width: 800, height: 400 }).surfaces[0]!.placement).toBe('flow');
  });
});
