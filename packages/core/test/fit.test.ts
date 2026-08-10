import { describe, expect, it } from 'vitest';
import { contentRect, parseObjectPosition } from '../src/fit.js';
import type { Size } from '../src/types.js';

const IMAGE: Size = { width: 4000, height: 2000 }; // 2:1

describe('contentRect', () => {
  it('fills the container exactly for fit=fill', () => {
    const rect = contentRect('fill', IMAGE, { width: 800, height: 800 });
    expect(rect).toEqual({ x: 0, y: 0, width: 800, height: 800 });
  });

  describe('contain', () => {
    it('letterboxes vertically in a taller container', () => {
      const rect = contentRect('contain', IMAGE, { width: 800, height: 800 });
      expect(rect.width).toBeCloseTo(800, 9);
      expect(rect.height).toBeCloseTo(400, 9);
      expect(rect.x).toBeCloseTo(0, 9);
      expect(rect.y).toBeCloseTo(200, 9);
    });

    it('pillarboxes horizontally in a wider container', () => {
      const rect = contentRect('contain', IMAGE, { width: 1200, height: 400 });
      expect(rect.width).toBeCloseTo(800, 9);
      expect(rect.height).toBeCloseTo(400, 9);
      expect(rect.x).toBeCloseTo(200, 9);
      expect(rect.y).toBeCloseTo(0, 9);
    });

    it('never overflows the container', () => {
      const rect = contentRect('contain', IMAGE, { width: 500, height: 900 });
      expect(rect.width).toBeLessThanOrEqual(500 + 1e-9);
      expect(rect.height).toBeLessThanOrEqual(900 + 1e-9);
    });
  });

  describe('cover', () => {
    it('overflows and centres, which is why surfaces cannot use the container box', () => {
      const rect = contentRect('cover', IMAGE, { width: 800, height: 800 });
      expect(rect.width).toBeCloseTo(1600, 9);
      expect(rect.height).toBeCloseTo(800, 9);
      // Negative x: the photo hangs off both sides. Anchoring surfaces to the
      // element box instead of this rect would drift them off their surface.
      expect(rect.x).toBeCloseTo(-400, 9);
      expect(rect.y).toBeCloseTo(0, 9);
    });

    it('always covers the container fully', () => {
      for (const container of [
        { width: 300, height: 900 },
        { width: 1600, height: 200 },
        { width: 640, height: 320 },
      ]) {
        const rect = contentRect('cover', IMAGE, container);
        expect(rect.width).toBeGreaterThanOrEqual(container.width - 1e-9);
        expect(rect.height).toBeGreaterThanOrEqual(container.height - 1e-9);
      }
    });

    it('preserves the source aspect ratio', () => {
      const rect = contentRect('cover', IMAGE, { width: 333, height: 777 });
      expect(rect.width / rect.height).toBeCloseTo(IMAGE.width / IMAGE.height, 9);
    });

    it('honours object-position', () => {
      const left = contentRect('cover', IMAGE, { width: 800, height: 800 }, [0, 0]);
      expect(left.x).toBeCloseTo(0, 9);
      const right = contentRect('cover', IMAGE, { width: 800, height: 800 }, [1, 1]);
      expect(right.x).toBeCloseTo(-800, 9);
    });
  });

  it('degrades gracefully for a zero-sized image', () => {
    const rect = contentRect('cover', { width: 0, height: 0 }, { width: 400, height: 300 });
    expect(rect).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });
});

describe('parseObjectPosition', () => {
  it('defaults to centred', () => {
    expect(parseObjectPosition(null)).toEqual([0.5, 0.5]);
    expect(parseObjectPosition('')).toEqual([0.5, 0.5]);
  });

  it('parses percentages and keywords', () => {
    expect(parseObjectPosition('0% 100%')).toEqual([0, 1]);
    expect(parseObjectPosition('left top')).toEqual([0, 0]);
    expect(parseObjectPosition('right bottom')).toEqual([1, 1]);
    expect(parseObjectPosition('center center')).toEqual([0.5, 0.5]);
  });

  it('fills in a missing second axis', () => {
    expect(parseObjectPosition('25%')).toEqual([0.25, 0.5]);
  });
});
