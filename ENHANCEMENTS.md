# Possible enhancements

Things deliberately left out of v1, with enough detail to pick up later. Nothing here is
a known bug — see the README's *Known limitations* for the shipped trade-offs.

## Occlusion masking

**The gap.** A surface is painted over the whole photo, so anything that should sit in
front of it — a hand resting on the laptop, a mug, a plant leaf — disappears. This is the
single biggest difference between "clearly an overlay" and "looks like it belongs".

**Approach.** Mark occluder polygons in the editor, alongside the surface quads. At
render time, draw the original photo again *above* the surface, clipped to those polygons
(`clip-path: polygon(...)` over a second copy of the image positioned identically to the
first). Because the occluder is cut from the real photo, lighting and grain match for
free.

The manifest format already has room for this: add an `occluders` array to a surface, each
with normalised polygon points. Anything reading a v1 manifest keeps working, so this can
ship as a minor version.

Soft edges are the hard part. A hard polygon edge reads as a cutout. Feathering via an SVG
mask with a blurred alpha channel would look better and is worth prototyping before
committing to the format.

## Documentation site

An Astro site with runnable examples, an interactive "drag these corners and watch the
matrix change" explainer, and the derivation written out properly. The README carries the
essentials for now; a real site is mostly what makes an OSS project adoptable.

## Typed Angular component wrapper

Angular currently binds to the custom element directly, which is the idiomatic
integration and needs no compiled Angular code — that is why `@image-aware/angular` builds
with plain `tsc`.

A first-class `<iae-image-surface>` component with typed inputs and outputs would need
`ng-packagr` for partial-Ivy compilation, plus the Angular compiler toolchain in the build.
Worth doing if people ask for typed template bindings; not worth the build complexity
before then.

## Edge-detection snapping

Corner placement is currently pure hand-eye, helped by the loupe. Running a Sobel or
Canny pass over a small window around the dragged corner and snapping to the strongest
line intersection would make marking rectangular screens much faster.

Keep it opt-in and easily overridden — snapping that fights the user is worse than none.
Should run in a worker; the editor has no dependencies today and it would be good to keep
it that way, so a small hand-rolled convolution is preferable to pulling in OpenCV.

## Automatic corner detection

One step further: detect candidate quadrilaterals in the photo and offer them. Classic
CV (contour finding plus polygon approximation) handles high-contrast screens well and
needs no model. Anything more general probably wants a segmentation model, which is a
much larger dependency conversation.

## Video and canvas surfaces

Nothing about the transform is specific to HTML. A `<video>` or `<canvas>` slotted into a
surface should already work; what is missing is testing it and documenting the caveats
(compositing cost, autoplay policies).

## 3D content on a surface

The pose maths already recovers a full camera pose, so a Three.js scene could be placed
in the photo's actual 3D frame rather than flattened onto the plane. `decomposePose`
returns everything needed; what is missing is an adapter that hands a camera matrix to a
renderer, and a decision about how the estimated focal length should be sourced (EXIF
would be better than the current heuristic).

## EXIF focal length

`defaultFocalPx` guesses 1.2× the long edge. Real EXIF data would make the orientation
readout physically meaningful rather than merely consistent. It affects only the reported
angles, never rendering.

## Manifest tooling

- A JSON Schema published alongside the format, for editor autocomplete.
- A codegen step that turns a manifest into typed per-surface components, so
  `<LaptopScreen>` exists instead of a stringly-typed `slot="laptop-screen"`.
