import { describe, expect, it } from 'vitest';
import { parseManifest, type CropRect, type Quad } from '@image-aware/core';
import { aspectDrift, visibleFraction } from '../src/geometry.js';
import { matchesViewport } from '../src/media.js';
import {
  createSurface,
  getState,
  looksAutoResolved,
  toManifest,
  update,
  variantsFromRaw,
  type EditorState,
} from '../src/state.js';

/** Occupies the right half of the photo, vertically centred. */
const RIGHT: Quad = [
  [0.55, 0.3],
  [0.9, 0.3],
  [0.9, 0.7],
  [0.55, 0.7],
];

describe('visibleFraction', () => {
  const container = { width: 100, height: 100 };

  it('is 1 for a surface wholly inside the frame', () => {
    const quad: Quad = [
      [10, 10],
      [90, 10],
      [90, 90],
      [10, 90],
    ];
    expect(visibleFraction(quad, container)).toBeCloseTo(1, 6);
  });

  it('is 0 for a surface entirely outside it', () => {
    const quad: Quad = [
      [-200, 10],
      [-120, 10],
      [-120, 90],
      [-200, 90],
    ];
    expect(visibleFraction(quad, container)).toBe(0);
  });

  it('measures the clipped share of a half-cropped surface', () => {
    const quad: Quad = [
      [-50, 0],
      [50, 0],
      [50, 100],
      [-50, 100],
    ];
    expect(visibleFraction(quad, container)).toBeCloseTo(0.5, 6);
  });

  it('clips the polygon rather than its bounding box', () => {
    // A diamond poking out of the left edge. Its bounding box would suggest far
    // more is missing than actually is, which would overstate the warning.
    const quad: Quad = [
      [0, 50],
      [50, 0],
      [100, 50],
      [50, 100],
    ];
    expect(visibleFraction(quad, container)).toBeCloseTo(1, 6);
  });
});

describe('matchesViewport', () => {
  const phone = { width: 390, height: 844 };
  const desktop = { width: 1440, height: 900 };

  it('evaluates width bounds against a hypothetical viewport', () => {
    expect(matchesViewport('(max-width: 900px)', phone)).toBe(true);
    expect(matchesViewport('(max-width: 900px)', desktop)).toBe(false);
    expect(matchesViewport('(min-width: 1000px)', desktop)).toBe(true);
  });

  it('handles and, or, and orientation', () => {
    expect(matchesViewport('(min-width: 300px) and (max-width: 500px)', phone)).toBe(true);
    expect(matchesViewport('(min-width: 300px) and (max-width: 380px)', phone)).toBe(false);
    expect(matchesViewport('(max-width: 100px), (max-width: 500px)', phone)).toBe(true);
    expect(matchesViewport('(orientation: portrait)', phone)).toBe(true);
    expect(matchesViewport('(orientation: portrait)', desktop)).toBe(false);
  });

  it('says "cannot say" rather than guessing at features it does not parse', () => {
    // The preview shows a manual picker in this case. Returning false would
    // quietly show the wrong variant, which is worse than admitting ignorance.
    expect(matchesViewport('(prefers-color-scheme: dark)', phone)).toBeNull();
    expect(matchesViewport('(min-resolution: 2dppx)', phone)).toBeNull();
  });

  it('lets a known false branch settle a query with an unknown one', () => {
    expect(matchesViewport('(min-width: 2000px) and (prefers-color-scheme: dark)', phone)).toBe(
      false,
    );
  });
});

describe('manifest round trip', () => {
  const state = {
    image: { url: 'blob:x', src: 'desk.jpg', width: 1600, height: 1000 },
    surfaces: [
      {
        id: 'menu',
        label: 'Menu',
        corners: RIGHT,
        resolution: [640, 400] as [number, number],
        clip: true,
        z: 0,
      },
    ],
    base: { crop: null, fit: '' as const, placements: {} },
    variants: [
      {
        key: 'v1',
        media: '(max-width: 480px)',
        crop: [0.1, 0.2, 0.5, 0.4] as CropRect,
        fit: 'cover' as const,
        placements: { menu: 'flow' as const },
        opaque: null,
      },
    ],
  } as unknown as EditorState;

  it('writes a file the library accepts, and reads its own output back', () => {
    const written = toManifest(state)!;
    // The real parser is the only judge that matters here.
    const parsed = parseManifest(written);
    expect(parsed.variants).toHaveLength(2);

    const [variant] = variantsFromRaw(written);
    expect(variant!.media).toBe('(max-width: 480px)');
    expect(variant!.crop).toEqual([0.1, 0.2, 0.5, 0.4]);
    expect(variant!.fit).toBe('cover');
    expect(variant!.placements).toEqual({ menu: 'flow' });
  });

  it('omits everything that was never set, so simple photos stay simple', () => {
    const plain = toManifest({ ...state, variants: [] } as unknown as EditorState)!;
    expect(plain).not.toHaveProperty('variants');
    expect(plain).not.toHaveProperty('crop');
    expect(plain).not.toHaveProperty('placements');
  });

  it('preserves a variant it cannot edit rather than dropping it', () => {
    const opaque = { media: '(max-width: 700px)', image: { src: 'p.jpg', width: 8, height: 9 } };
    const written = toManifest({
      ...state,
      variants: [{ key: 'v1', media: '', crop: null, fit: '', placements: {}, opaque }],
    } as unknown as EditorState)!;

    expect(written.variants).toEqual([opaque]);
  });
});

describe('design resolution tracking', () => {
  const image = { url: 'blob:x', src: 'desk.jpg', width: 1600, height: 1000 };

  /** A quad the size of the editor's default starting box. */
  const START: Quad = [
    [0.3, 0.3],
    [0.7, 0.3],
    [0.7, 0.7],
    [0.3, 0.7],
  ];

  it('starts a new surface matched to its own quad', () => {
    const surface = createSurface(image, []);
    expect(surface.autoResolution).toBe(true);
    expect(surface.resolution).toEqual([640, 400]);
  });

  it('follows the corners wherever they are dragged', () => {
    // The bug this exists for: the resolution used to keep the value estimated
    // from the starting box, so every marked surface was silently the wrong
    // shape until someone happened to press "Match quad size".
    update((draft) => {
      draft.image = image;
      draft.surfaces = [
        {
          id: 'cube',
          label: 'Cube',
          corners: START,
          resolution: [640, 400],
          autoResolution: true,
          clip: true,
          z: 0,
        },
      ];
    });

    update((draft) => {
      draft.surfaces[0]!.corners = RIGHT;
    });

    const [width, height] = getState().surfaces[0]!.resolution;
    expect([width, height]).toEqual([560, 400]);
    // 0.35 x 0.4 of a 1600x1000 photo: the shape now matches the quad.
    expect(width / height).toBeCloseTo((0.35 * 1600) / (0.4 * 1000), 6);
  });

  it('leaves a hand-picked resolution alone', () => {
    update((draft) => {
      draft.surfaces[0]!.resolution = [1280, 800];
      draft.surfaces[0]!.autoResolution = false;
    });
    update((draft) => {
      draft.surfaces[0]!.corners = START;
    });

    expect(getState().surfaces[0]!.resolution).toEqual([1280, 800]);
  });

  it('reads a stored resolution as deliberate only when it differs', () => {
    expect(looksAutoResolved([640, 400], START, image)).toBe(true);
    expect(looksAutoResolved([1280, 800], START, image)).toBe(false);
  });

  it('measures the stretch a mismatched resolution causes', () => {
    const stretched = {
      id: 'cube',
      label: '',
      corners: RIGHT,
      resolution: [1120, 400] as [number, number],
      autoResolution: false,
      clip: true,
      z: 0,
    };
    // The quad is 560x400, so a 1120-wide design space is twice its shape.
    expect(aspectDrift(stretched, image)).toBeCloseTo(1, 6);
    expect(aspectDrift({ ...stretched, resolution: [560, 400] }, image)).toBeCloseTo(0, 6);
  });
});
