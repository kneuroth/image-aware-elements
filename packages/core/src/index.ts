export type {
  CameraModel,
  CropRect,
  Homography,
  ObjectFit,
  Point,
  Pose,
  Quad,
  Rect,
  Size,
  SurfacePlacement,
} from './types.js';

export {
  applyHomography,
  homographyDepth,
  mapQuad,
  preTranslateHomography,
  rectToQuad,
  scaleHomography,
  solveHomography,
  toMatrix3d,
  translateHomography,
} from './homography.js';

export {
  crossZ,
  describeIssue,
  isConvex,
  isInFront,
  signedArea,
  validateQuad,
  winding,
  type QuadIssue,
  type QuadValidation,
} from './quad.js';

export { contentRect, cropContentRect, parseObjectPosition } from './fit.js';

export {
  composeQuad,
  decomposePose,
  defaultCamera,
  defaultFocalPx,
  poseDistance,
  withAngles,
} from './pose.js';

export {
  MANIFEST_VERSION,
  ManifestError,
  estimateResolution,
  parseManifest,
  parseManifestJson,
  type Manifest,
  type ManifestCamera,
  type ManifestImage,
  type ManifestInput,
  type ManifestSource,
  type ManifestSurface,
  type ManifestVariant,
} from './manifest.js';

export {
  computeLayout,
  observeSize,
  prepareManifest,
  selectVariant,
  type Layout,
  type PreparedManifest,
  type PreparedSurface,
  type PreparedVariant,
  type SurfaceLayout,
} from './layout.js';
