import { describe, expect, it, vi } from 'vitest';
import { prepareManifest, selectVariant } from '../src/layout.js';
import { ManifestError, parseManifest } from '../src/manifest.js';
import type { Quad } from '../src/types.js';

const CORNERS: Quad = [
  [0.2, 0.25],
  [0.7, 0.2],
  [0.75, 0.65],
  [0.25, 0.6],
];

const PORTRAIT_CORNERS: Quad = [
  [0.1, 0.3],
  [0.9, 0.28],
  [0.92, 0.7],
  [0.08, 0.68],
];

function raw(variants?: unknown) {
  return {
    version: 1,
    image: { src: 'desk.jpg', width: 1600, height: 1000 },
    surfaces: [{ id: 'screen', corners: CORNERS, resolution: [1280, 800] }],
    ...(variants === undefined ? {} : { variants }),
  };
}

describe('parseManifest variants', () => {
  it('always ends with an unconditional variant built from the top level', () => {
    const manifest = parseManifest(raw());

    expect(manifest.variants).toHaveLength(1);
    expect(manifest.variants![0]!.media).toBeUndefined();
    expect(manifest.variants![0]!.image.src).toBe('desk.jpg');
    expect(manifest.variants![0]!.surfaces).toEqual(manifest.surfaces);
  });

  it('keeps declared variants in order and appends the default last', () => {
    const manifest = parseManifest(
      raw([{ media: '(max-width: 700px)', fit: 'cover', objectPosition: '78% 50%' }]),
    );

    expect(manifest.variants!.map((v) => v.media)).toEqual(['(max-width: 700px)', undefined]);
  });

  it('inherits image and surfaces for a framing-only variant', () => {
    // The common case: same photo, different crop. Corners are fractions of the
    // image, so they carry over untouched and nothing needs re-marking.
    const manifest = parseManifest(raw([{ media: '(max-width: 700px)', objectPosition: '90% 50%' }]));
    const variant = manifest.variants![0]!;

    expect(variant.image).toEqual(manifest.image);
    expect(variant.surfaces).toEqual(manifest.surfaces);
    expect(variant.objectPosition).toBe('90% 50%');
  });

  it('accepts its own image when the surfaces are marked against it', () => {
    const manifest = parseManifest(
      raw([
        {
          media: '(max-width: 700px)',
          image: { src: 'desk-portrait.jpg', width: 1080, height: 1440 },
          surfaces: [{ id: 'screen', corners: PORTRAIT_CORNERS, resolution: [640, 400] }],
        },
      ]),
    );
    const variant = manifest.variants![0]!;

    expect(variant.image.src).toBe('desk-portrait.jpg');
    expect(variant.surfaces[0]!.corners).toEqual(PORTRAIT_CORNERS);
    // The top level is untouched by the override.
    expect(manifest.image.src).toBe('desk.jpg');
  });

  it('refuses an image override without surfaces', () => {
    // Corners are fractions of *their* image, so reusing them against a
    // differently shaped photo drifts every surface. Silence would be worse.
    expect(() =>
      parseManifest(
        raw([{ media: '(max-width: 700px)', image: { src: 'p.jpg', width: 1080, height: 1440 } }]),
      ),
    ).toThrow(ManifestError);

    expect(() =>
      parseManifest(
        raw([{ media: '(max-width: 700px)', image: { src: 'p.jpg', width: 1080, height: 1440 } }]),
      ),
    ).toThrow(/variants\[0\]\.surfaces/);
  });

  it('estimates a variant resolution against the variant image, not the default', () => {
    const manifest = parseManifest(
      raw([
        {
          image: { src: 'p.jpg', width: 1000, height: 1000 },
          surfaces: [{ id: 'screen', corners: [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]] }],
        },
      ]),
    );

    expect(manifest.variants![0]!.surfaces[0]!.resolution).toEqual([500, 500]);
  });

  it('rejects a blank media query and a non-string objectPosition', () => {
    expect(() => parseManifest(raw([{ media: '   ' }]))).toThrow(/variants\[0\]\.media/);
    expect(() => parseManifest(raw([{ objectPosition: 5 }]))).toThrow(
      /variants\[0\]\.objectPosition/,
    );
  });

  it('rejects variants that are not an array', () => {
    expect(() => parseManifest(raw({ media: 'print' }))).toThrow(/variants/);
  });

  it('leaves a manifest without variants readable by older consumers', () => {
    // `variants` is additive under version 1 on purpose: the version guard rejects
    // anything newer outright, so bumping would hard-break old readers whereas an
    // unknown key just gets ignored and the top level renders.
    const manifest = parseManifest(raw([{ media: '(max-width: 700px)', flat: true }]));

    expect(manifest.version).toBe(1);
    expect(manifest.image).toBeDefined();
    expect(manifest.surfaces).toHaveLength(1);
  });
});

describe('selectVariant', () => {
  const prepared = () =>
    prepareManifest(
      parseManifest(
        raw([
          { media: '(max-width: 480px)', flat: true },
          { media: '(max-width: 900px)', objectPosition: '80% 50%' },
        ]),
      ),
    );

  it('takes the first matching variant', () => {
    const variant = selectVariant(prepared(), (media) => media === '(max-width: 900px)');
    expect(variant.objectPosition).toBe('80% 50%');
    expect(variant.flat).toBe(false);
  });

  it('prefers the earlier of two matches, so narrower queries go first', () => {
    const variant = selectVariant(prepared(), () => true);
    expect(variant.media).toBe('(max-width: 480px)');
    expect(variant.flat).toBe(true);
  });

  it('falls back to the unconditional variant when nothing matches', () => {
    const variant = selectVariant(prepared(), () => false);
    expect(variant.media).toBeUndefined();
    expect(variant.flat).toBe(false);
  });

  it('stops asking once it has a match', () => {
    const matches = vi.fn(() => true);
    selectVariant(prepared(), matches);

    expect(matches).toHaveBeenCalledTimes(1);
    expect(matches).toHaveBeenCalledWith('(max-width: 480px)');
  });

  it('solves every variant up front, so crossing a breakpoint costs nothing', () => {
    for (const variant of prepared().variants) {
      expect(variant.surfaces[0]!.reference).not.toBeNull();
      expect(variant.surfaces[0]!.ok).toBe(true);
    }
  });
});
