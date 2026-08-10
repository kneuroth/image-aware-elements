import { describe, expect, it } from 'vitest';
import { rectToQuad, solveHomography } from '../src/homography.js';
import { composeQuad, decomposePose, defaultCamera, withAngles } from '../src/pose.js';
import { isConvex } from '../src/quad.js';
import type { CameraModel, Pose, Quad, Size } from '../src/types.js';

const IMAGE: Size = { width: 4032, height: 3024 };
const RESOLUTION: Size = { width: 1280, height: 800 };
const CAMERA: CameraModel = defaultCamera(IMAGE);

function homographyFor(quad: Quad) {
  const h = solveHomography(rectToQuad(RESOLUTION), quad);
  expect(h).not.toBeNull();
  return h!;
}

function poseAt(yaw: number, pitch: number, roll: number, distance = 4000): Pose {
  return { yaw, pitch, roll, translation: [0, 0, distance] };
}

describe('decomposePose', () => {
  it('reports zero rotation for a surface square-on to the camera', () => {
    const quad = composeQuad(poseAt(0, 0, 0), RESOLUTION, CAMERA)!;
    const pose = decomposePose(homographyFor(quad), RESOLUTION, CAMERA)!;

    expect(pose.yaw).toBeCloseTo(0, 6);
    expect(pose.pitch).toBeCloseTo(0, 6);
    expect(pose.roll).toBeCloseTo(0, 6);
  });

  it('recovers each axis in isolation without cross-talk', () => {
    const cases: Array<[string, Pose]> = [
      ['yaw', poseAt(35, 0, 0)],
      ['pitch', poseAt(0, -22, 0)],
      ['roll', poseAt(0, 0, 14)],
    ];

    for (const [axis, expected] of cases) {
      const quad = composeQuad(expected, RESOLUTION, CAMERA)!;
      const actual = decomposePose(homographyFor(quad), RESOLUTION, CAMERA)!;
      expect(actual.yaw, `${axis}: yaw`).toBeCloseTo(expected.yaw, 5);
      expect(actual.pitch, `${axis}: pitch`).toBeCloseTo(expected.pitch, 5);
      expect(actual.roll, `${axis}: roll`).toBeCloseTo(expected.roll, 5);
    }
  });

  it('round-trips a sweep of combined orientations', () => {
    for (const yaw of [-50, -20, 0, 20, 50]) {
      for (const pitch of [-35, 0, 35]) {
        for (const roll of [-15, 0, 15]) {
          const expected = poseAt(yaw, pitch, roll);
          const quad = composeQuad(expected, RESOLUTION, CAMERA);
          expect(quad, `pose ${yaw}/${pitch}/${roll} should project`).not.toBeNull();

          const actual = decomposePose(homographyFor(quad!), RESOLUTION, CAMERA)!;
          const label = `${yaw}/${pitch}/${roll}`;
          expect(actual.yaw, `${label} yaw`).toBeCloseTo(yaw, 4);
          expect(actual.pitch, `${label} pitch`).toBeCloseTo(pitch, 4);
          expect(actual.roll, `${label} roll`).toBeCloseTo(roll, 4);
        }
      }
    }
  });

  it('recovers translation, so sliders keep the surface where it was', () => {
    const expected: Pose = { yaw: 18, pitch: -9, roll: 3, translation: [340, -120, 3800] };
    const quad = composeQuad(expected, RESOLUTION, CAMERA)!;
    const actual = decomposePose(homographyFor(quad), RESOLUTION, CAMERA)!;

    expect(actual.translation[0]).toBeCloseTo(340, 2);
    expect(actual.translation[1]).toBeCloseTo(-120, 2);
    expect(actual.translation[2]).toBeCloseTo(3800, 2);
  });
});

describe('composeQuad', () => {
  it('is the exact inverse of decompose for the quad itself', () => {
    const original = composeQuad(poseAt(28, -16, 7), RESOLUTION, CAMERA)!;
    const pose = decomposePose(homographyFor(original), RESOLUTION, CAMERA)!;
    const rebuilt = composeQuad(pose, RESOLUTION, CAMERA)!;

    original.forEach((corner, i) => {
      expect(rebuilt[i]![0]).toBeCloseTo(corner[0], 3);
      expect(rebuilt[i]![1]).toBeCloseTo(corner[1], 3);
    });
  });

  it('always produces a convex quad, which is what makes the sliders safe', () => {
    for (const yaw of [-70, -40, 0, 40, 70]) {
      for (const pitch of [-70, -40, 0, 40, 70]) {
        const quad = composeQuad(poseAt(yaw, pitch, 0, 5000), RESOLUTION, CAMERA);
        if (!quad) continue;
        expect(isConvex(quad), `pose ${yaw}/${pitch} produced a non-convex quad`).toBe(true);
      }
    }
  });

  it('refuses a pose that would put the surface behind the camera', () => {
    const behind: Pose = { yaw: 0, pitch: 0, roll: 0, translation: [0, 0, -100] };
    expect(composeQuad(behind, RESOLUTION, CAMERA)).toBeNull();
  });

  it('rotates about the surface centre, leaving it fixed on screen', () => {
    const base = poseAt(0, 0, 0);
    const turned = withAngles(base, { yaw: 30 });
    const a = composeQuad(base, RESOLUTION, CAMERA)!;
    const b = composeQuad(turned, RESOLUTION, CAMERA)!;

    const centre = (q: Quad) => [
      (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4,
      (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4,
    ];
    const [ax, ay] = centre(a);
    const [bx, by] = centre(b);

    // Perspective foreshortening shifts the centroid slightly, but it must not
    // wander off — otherwise dragging a slider would fling the surface away.
    expect(Math.abs(bx - ax)).toBeLessThan(RESOLUTION.width * 0.05);
    expect(Math.abs(by - ay)).toBeLessThan(RESOLUTION.height * 0.05);
  });
});
