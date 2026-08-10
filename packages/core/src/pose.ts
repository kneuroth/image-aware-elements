import { preTranslateHomography } from './homography.js';
import type { CameraModel, Homography, Point, Pose, Quad, Size } from './types.js';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

type Mat3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

/**
 * A reasonable focal length when the photo carries no EXIF data.
 *
 * Phone and compact cameras cluster around 1.1-1.4x the long edge in pixels. The
 * exact value only rescales the recovered angles slightly; it does not affect
 * rendering at all, because rendering uses the homography directly. It matters
 * only for how the yaw/pitch/roll readout *reads*.
 */
export function defaultFocalPx(image: Size): number {
  return 1.2 * Math.max(image.width, image.height);
}

/** A camera model centred on the image with an estimated focal length. */
export function defaultCamera(image: Size): CameraModel {
  return { focalPx: defaultFocalPx(image), principal: [image.width / 2, image.height / 2] };
}

/**
 * Build the rotation matrix for a pose: `R = Ry(yaw) * Rx(pitch) * Rz(roll)`.
 *
 * "Turn, then tilt, then spin" — the order that makes the sliders feel right,
 * because yaw and pitch stay independent of roll.
 *
 * Yaw and pitch are negated on the way in. The camera model here is the standard
 * computer-vision one, with +Z pointing *away* from the camera, while CSS
 * `rotateX`/`rotateY` assume +Z points *toward* the viewer. Flipping the Z axis
 * negates rotations about X and Y but leaves rotation about Z alone — so this
 * negation (and its mirror in {@link eulerOf}) is what makes a positive yaw here
 * mean the same thing as a positive `rotateY` in CSS. Without it the sliders
 * would move the surface the opposite way to every reader's expectation.
 */
function rotationOf(yaw: number, pitch: number, roll: number): Mat3 {
  const cy = Math.cos(-yaw * RAD);
  const sy = Math.sin(-yaw * RAD);
  const cp = Math.cos(-pitch * RAD);
  const sp = Math.sin(-pitch * RAD);
  const cr = Math.cos(roll * RAD);
  const sr = Math.sin(roll * RAD);

  return [
    [cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp],
    [cp * sr, cp * cr, -sp],
    [-sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp],
  ];
}

/**
 * Read yaw/pitch/roll back out of a rotation matrix.
 *
 * The extraction formulas are derived from the exact `R` built by
 * {@link rotationOf}, so `eulerOf(rotationOf(p)) === p`. Getting these two out of
 * sync is the classic way an angle round-trip silently drifts.
 */
function eulerOf(r: Mat3): { yaw: number; pitch: number; roll: number } {
  const sp = clamp(-r[1][2], -1, 1);
  const pitch = Math.asin(sp);
  const cosPitch = Math.sqrt(1 - sp * sp);

  // Negated to undo the Z-axis flip applied in rotationOf; see the note there.
  if (cosPitch < 1e-6) {
    // Gimbal lock: yaw and roll describe the same rotation, so pin roll to zero.
    return { yaw: -Math.atan2(r[0][1], r[0][0]) * DEG, pitch: -pitch * DEG, roll: 0 };
  }

  return {
    yaw: -Math.atan2(r[0][2], r[2][2]) * DEG,
    pitch: -pitch * DEG,
    roll: Math.atan2(r[1][0], r[1][1]) * DEG,
  };
}

/**
 * Recover the 3D orientation of a surface from its homography.
 *
 * Standard planar-pose recovery: `K^-1 * H` gives the first two columns of the
 * rotation matrix plus the translation, all sharing one unknown scale. Normalising
 * by the average column length fixes the scale, Gram-Schmidt cleans up the
 * numerical drift, and the third column is their cross product.
 *
 * `h` must map the design rect `(0,0)..(W,H)` into the same pixel space the camera
 * model describes — for a photo, that is intrinsic image pixels.
 *
 * The recovered rotation is a best fit. An arbitrary hand-drawn quad is not
 * necessarily the perspective image of a `resolution`-shaped rectangle, so
 * `composeQuad(decomposePose(q))` will land near `q` but not exactly on it. The
 * reverse direction is exact.
 */
export function decomposePose(h: Homography, resolution: Size, camera: CameraModel): Pose | null {
  // Re-origin the source rect to its centre: pose is about the surface's middle,
  // not its top-left corner.
  const centred = preTranslateHomography(h, resolution.width / 2, resolution.height / 2);
  if (!centred) return null;

  const [a, b, c, d, e, f, g, hh] = centred;
  const { focalPx: fl, principal } = camera;
  const [cx, cy] = principal;
  if (!(fl > 0)) return null;

  // M = K^-1 * H, with K = [[fl, 0, cx], [0, fl, cy], [0, 0, 1]]
  const m = [
    [(a - cx * g) / fl, (b - cx * hh) / fl, (c - cx) / fl],
    [(d - cy * g) / fl, (e - cy * hh) / fl, (f - cy) / fl],
    [g, hh, 1],
  ] as const;

  let r1: number[] = [m[0][0], m[1][0], m[2][0]];
  let r2: number[] = [m[0][1], m[1][1], m[2][1]];
  const t3: number[] = [m[0][2], m[1][2], m[2][2]];

  const n1 = norm(r1);
  const n2 = norm(r2);
  if (n1 < 1e-12 || n2 < 1e-12) return null;

  // One scale factor serves all three columns; the average keeps it even-handed.
  const lambda = 2 / (n1 + n2);
  r1 = r1.map((v) => v * lambda);
  r2 = r2.map((v) => v * lambda);
  const t = t3.map((v) => v * lambda);

  // Symmetric Gram-Schmidt: split the error between the two axes rather than
  // treating one as authoritative.
  const skew = dot(r1, r2);
  const s1 = r1.map((v, i) => v - (skew / 2) * r2[i]!);
  const s2 = r2.map((v, i) => v - (skew / 2) * r1[i]!);
  const u1 = normalize(s1);
  const u2 = normalize(s2);
  if (!u1 || !u2) return null;
  const u3 = cross(u1, u2);

  const rot: Mat3 = [
    [u1[0]!, u2[0]!, u3[0]!],
    [u1[1]!, u2[1]!, u3[1]!],
    [u1[2]!, u2[2]!, u3[2]!],
  ];

  const { yaw, pitch, roll } = eulerOf(rot);
  return { yaw, pitch, roll, translation: [t[0]!, t[1]!, t[2]!] };
}

/**
 * Project a surface at a given pose back into image space.
 *
 * The exact inverse of {@link decomposePose}: the design rect is centred on the
 * origin, rotated, translated into camera space, and projected through the pinhole
 * model. Because it always starts from a real rectangle in 3D, the result is
 * guaranteed to be a geometrically valid quad — which is what makes the editor's
 * angle sliders safe to drag.
 *
 * Returns `null` if any corner would land behind the camera.
 */
export function composeQuad(pose: Pose, resolution: Size, camera: CameraModel): Quad | null {
  const r = rotationOf(pose.yaw, pose.pitch, pose.roll);
  const [tx, ty, tz] = pose.translation;
  const { focalPx: fl, principal } = camera;
  const halfW = resolution.width / 2;
  const halfH = resolution.height / 2;

  const local: Point[] = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];

  const out: Point[] = [];
  for (const [lx, ly] of local) {
    const x = r[0][0] * lx + r[0][1] * ly + tx;
    const y = r[1][0] * lx + r[1][1] * ly + ty;
    const z = r[2][0] * lx + r[2][1] * ly + tz;
    if (!(z > 1e-9)) return null;
    out.push([(fl * x) / z + principal[0], (fl * y) / z + principal[1]]);
  }

  return out as unknown as Quad;
}

/** Replace one or more angles on a pose, leaving its position untouched. */
export function withAngles(
  pose: Pose,
  angles: Partial<Pick<Pose, 'yaw' | 'pitch' | 'roll'>>,
): Pose {
  return {
    yaw: angles.yaw ?? pose.yaw,
    pitch: angles.pitch ?? pose.pitch,
    roll: angles.roll ?? pose.roll,
    translation: pose.translation,
  };
}

/** Distance from camera to surface centre, in design-space units. */
export function poseDistance(pose: Pose): number {
  return norm([...pose.translation]);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function norm(v: number[]): number {
  return Math.hypot(v[0]!, v[1]!, v[2]!);
}

function dot(a: number[], b: number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

function normalize(v: number[]): number[] | null {
  const n = norm(v);
  if (n < 1e-12) return null;
  return [v[0]! / n, v[1]! / n, v[2]! / n];
}

function cross(a: number[], b: number[]): number[] {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}
