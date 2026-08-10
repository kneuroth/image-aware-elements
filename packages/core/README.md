# @image-aware/core

The maths behind [image-aware-elements](https://github.com/kneuroth/image-aware-elements):
mapping HTML onto a flat surface inside a photograph.

Zero dependencies, no DOM. Everything else in the project is a thin adapter over this.

```ts
import { rectToQuad, solveHomography, toMatrix3d } from '@image-aware/core';

const design = rectToQuad({ width: 1280, height: 800 });
const marked = [
  [420, 310],
  [980, 255],
  [1050, 640],
  [380, 590],
] as const;

const h = solveHomography(design, marked)!;
element.style.transformOrigin = '0 0';
element.style.transform = toMatrix3d(h);
```

Do not put the result inside a CSS `perspective`: the projective divide is already in the
matrix, and an ancestor `perspective` would apply it twice.

## What's in it

- `solveHomography` / `applyHomography` / `toMatrix3d` — the projective transform.
- `scaleHomography` / `translateHomography` — O(1) responsive updates, no re-solve.
- `validateQuad` — rejects non-convex, degenerate and behind-camera quads. Worth calling:
  the solver returns plausible-looking output for a bowtie rather than failing.
- `decomposePose` / `composeQuad` — recover and rebuild a surface's orientation. Angles
  follow CSS `rotateY` / `rotateX` / `rotateZ` conventions.
- `contentRect` — where a photo actually lands under `object-fit`, which surfaces must
  track rather than the element box.
- `parseManifest`, `prepareManifest`, `computeLayout` — the manifest format and layout
  engine. `computeLayout` also reports, per surface, the projected `quad` in container
  pixels and a `scale` — the shortest projected edge over its design edge — which is what
  answers "is this control still big enough to tap".
- `selectVariant` — pick the media-gated variant to render. Takes a matcher rather than
  touching `matchMedia`, so the responsive story stays testable in Node.

Full documentation in the [project README](https://github.com/kneuroth/image-aware-elements#readme).

MIT
