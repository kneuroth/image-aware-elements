import { describe, expect, it } from 'vitest';
import { composeQuad, defaultCamera } from '../src/pose.js';
import type { Pose, Quad, Size } from '../src/types.js';

/**
 * These tests exist to pin down the documented sign conventions.
 *
 * A pose round-trip passes just as happily with every angle inverted, so it
 * structurally cannot catch a flipped axis — only an assertion about which way
 * the surface actually turns can. The contract being locked in is that `yaw`,
 * `pitch` and `roll` behave like CSS `rotateY`, `rotateX` and `rotateZ`, which
 * is what anyone reaching for this library already has in their head.
 */

const IMAGE: Size = { width: 4032, height: 3024 };
const RESOLUTION: Size = { width: 1280, height: 800 };
const CAMERA = defaultCamera(IMAGE);

const pose = (yaw: number, pitch: number, roll = 0): Pose => ({
  yaw,
  pitch,
  roll,
  translation: [0, 0, 4000],
});

function quadAt(yaw: number, pitch: number, roll = 0): Quad {
  const quad = composeQuad(pose(yaw, pitch, roll), RESOLUTION, CAMERA);
  expect(quad).not.toBeNull();
  return quad!;
}

function edges(yaw: number, pitch: number) {
  const q = quadAt(yaw, pitch);
  const length = (a: number, b: number) => Math.hypot(q[a]![0] - q[b]![0], q[a]![1] - q[b]![1]);
  return { top: length(0, 1), bottom: length(3, 2), left: length(0, 3), right: length(1, 2) };
}

describe('yaw behaves like CSS rotateY', () => {
  it('positive yaw pushes the right edge away, so it foreshortens', () => {
    const e = edges(30, 0);
    expect(e.right).toBeLessThan(e.left);
  });

  it('negative yaw brings the right edge closer, so it grows', () => {
    const e = edges(-30, 0);
    expect(e.right).toBeGreaterThan(e.left);
  });

  it('zero yaw keeps both side edges equal', () => {
    const e = edges(0, 0);
    expect(e.right).toBeCloseTo(e.left, 6);
  });
});

describe('pitch behaves like CSS rotateX', () => {
  it('positive pitch pushes the top edge away, so it foreshortens', () => {
    const e = edges(0, 30);
    expect(e.top).toBeLessThan(e.bottom);
  });

  it('negative pitch brings the top edge closer, so it grows', () => {
    const e = edges(0, -30);
    expect(e.top).toBeGreaterThan(e.bottom);
  });

  it('zero pitch keeps top and bottom equal', () => {
    const e = edges(0, 0);
    expect(e.top).toBeCloseTo(e.bottom, 6);
  });
});

describe('roll behaves like CSS rotateZ', () => {
  it('positive roll turns the surface clockwise on screen', () => {
    // Screen space is y-down, so a clockwise turn drops the top-right corner
    // relative to the top-left.
    const q = quadAt(0, 0, 20);
    expect(q[1]![1]).toBeGreaterThan(q[0]![1]);
  });

  it('negative roll turns it the other way', () => {
    const q = quadAt(0, 0, -20);
    expect(q[1]![1]).toBeLessThan(q[0]![1]);
  });
});
