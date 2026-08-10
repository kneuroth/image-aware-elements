import { describe, expect, it } from 'vitest';
import {
  MANIFEST_VERSION,
  ManifestError,
  estimateResolution,
  parseManifest,
  parseManifestJson,
} from '../src/manifest.js';
import type { Quad } from '../src/types.js';

const CORNERS: Quad = [
  [0.2, 0.25],
  [0.7, 0.2],
  [0.75, 0.65],
  [0.25, 0.6],
];

const VALID = {
  version: 1,
  image: { src: 'laptop.jpg', width: 4000, height: 2000 },
  surfaces: [{ id: 'screen', corners: CORNERS, resolution: [1280, 800] }],
};

describe('parseManifest', () => {
  it('accepts a well-formed manifest and applies defaults', () => {
    const parsed = parseManifest(VALID);
    expect(parsed.version).toBe(MANIFEST_VERSION);
    expect(parsed.surfaces[0]!.clip).toBe(true);
    expect(parsed.surfaces[0]!.z).toBe(0);
    expect(parsed.fit).toBeUndefined();
  });

  it('estimates a resolution when none is given', () => {
    const parsed = parseManifest({
      ...VALID,
      surfaces: [{ id: 'screen', corners: CORNERS }],
    });
    const [w, h] = parsed.surfaces[0]!.resolution;
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
    // Roughly the size the surface occupies in the photo: ~0.5 * 4000 wide.
    expect(w).toBeGreaterThan(1500);
    expect(w).toBeLessThan(2500);
  });

  it('rejects a manifest from a future version rather than guessing', () => {
    expect(() => parseManifest({ ...VALID, version: 99 })).toThrow(ManifestError);
    expect(() => parseManifest({ ...VALID, version: 99 })).toThrow(/newer than this library/);
  });

  it('rejects duplicate surface ids, which would collide as slot names', () => {
    expect(() =>
      parseManifest({
        ...VALID,
        surfaces: [
          { id: 'screen', corners: CORNERS, resolution: [10, 10] },
          { id: 'screen', corners: CORNERS, resolution: [10, 10] },
        ],
      }),
    ).toThrow(/Duplicate surface id/);
  });

  it('reports the failing path', () => {
    try {
      parseManifest({ ...VALID, image: { src: 'x.jpg', width: -1, height: 2000 } });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ManifestError);
      expect((error as ManifestError).path).toBe('image.width');
    }
  });

  it.each([
    ['a non-object', 42],
    ['a missing image', { version: 1, surfaces: [] }],
    ['an empty src', { ...VALID, image: { src: '', width: 10, height: 10 } }],
    ['non-array surfaces', { ...VALID, surfaces: {} }],
    ['a surface without an id', { ...VALID, surfaces: [{ corners: CORNERS }] }],
    ['three corners', { ...VALID, surfaces: [{ id: 'a', corners: CORNERS.slice(0, 3) }] }],
    ['a non-numeric corner', { ...VALID, surfaces: [{ id: 'a', corners: [['x', 0], [1, 0], [1, 1], [0, 1]] }] }],
  ])('rejects %s', (_label, input) => {
    expect(() => parseManifest(input)).toThrow(ManifestError);
  });

  it('preserves an explicit fit and camera', () => {
    const parsed = parseManifest({ ...VALID, fit: 'cover', camera: { focalPx: 3200 } });
    expect(parsed.fit).toBe('cover');
    expect(parsed.camera?.focalPx).toBe(3200);
  });

  it('drops an unusable pose rather than half-trusting it', () => {
    const parsed = parseManifest({
      ...VALID,
      surfaces: [{ id: 'screen', corners: CORNERS, resolution: [10, 10], pose: { yaw: 1 } }],
    });
    expect(parsed.surfaces[0]!.pose).toBeUndefined();
  });
});

describe('parseManifestJson', () => {
  it('parses valid JSON', () => {
    expect(parseManifestJson(JSON.stringify(VALID)).surfaces).toHaveLength(1);
  });

  it('wraps syntax errors as ManifestError', () => {
    expect(() => parseManifestJson('{ not json')).toThrow(ManifestError);
    expect(() => parseManifestJson('{ not json')).toThrow(/Invalid JSON/);
  });
});

describe('estimateResolution', () => {
  it('measures the quad in image pixels', () => {
    const square: Quad = [
      [0, 0],
      [0.5, 0],
      [0.5, 0.5],
      [0, 0.5],
    ];
    const [w, h] = estimateResolution(square, { width: 4000, height: 2000 });
    expect(w).toBe(2000);
    expect(h).toBe(1000);
  });
});
