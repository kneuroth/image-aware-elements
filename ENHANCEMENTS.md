# Possible enhancements

Things deliberately left out of v1, with enough detail to pick up later. Nothing here is
a known bug — see the README's *Known limitations* for the shipped trade-offs.

Several of the later entries came from a consumer's first full integration instead: gaps found
in the field rather than things deliberately deferred.

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

## Manifest ownership

**The gap.** The manifest is a contested artifact. The editor owns the file, but the app needs
fields in it too, and they fight. Re-marking a photo discards whatever the app author added:
`clip: false` on three surfaces reverted to `true` twice in one integration, silently killing an
outward glow, and hand-added variants carrying their own `image` were lost the same way.
Variants authored in Screens mode survived, which puts this on the re-mark path rather than on
variants generally.

The failure mode is what makes it expensive. Nothing errors, nothing warns; the page quietly
loses a feature, and you find out by pixel-diffing a screenshot.

**Approach.** The cheap half is documentation and works today: `manifest` accepts an object, not
only a URL, so an app can layer its own `clip`/`fit`/`variants` over the tool's output and
compose the two at load. Nothing says so.

The structural half is to stop the two authors sharing a file at all — the editor owns geometry,
the app owns presentation. That is a format decision worth making deliberately rather than
discovering, and it would make the layering above the default rather than a trick.

## Authoring diagnostics

The element already warns for an unusable quad, and for an image whose aspect ratio disagrees
with the manifest's declared size. Those are the two failures someone thought to catch; these
are the ones still silent. All four want dev-mode warnings, not errors — none should stop a
render.

- **A `placements` key naming a surface that does not exist.** `parsePlacements` never receives
  the surfaces list, so it cannot check, and `placementOf` is a plain lookup that simply never
  reads the stray key. It survives repeated exports, pointing at nothing. This is the same class
  of authoring error as a bad quad, which is already warned about.
- **Content overflowing a clipping surface.** `clip: true` is `overflow: hidden`, and nothing
  measures what got cut. One integration found 503×143 of content inside a 490×363 box by
  writing a Playwright script to compare `scrollWidth` against `clientWidth`; there is no other
  way to see it.
- **`scale` below a legibility threshold.** The number is right, and the editor's Screens mode
  uses it well — including a "a 44px control renders at 32px" rule. But those thresholds live
  only in the editor. The element never reads `surface.scale`, so nothing warns when a real app
  ships something at 13px.
- **A transposed `resolution` on a rotated surface.** Invisible until you render text, at which
  point the symptom is a sideways word. The tell is already in the file — a portrait resolution
  against an obviously landscape footprint — and `aspectDrift` already computes the comparison
  for the editor.

While in there: the element's bad-quad warning prints raw issue codes, though `describeIssue`
exports the human strings the editor uses.

## A CSS hook for floated surfaces

**The gap.** `data-flat` gives page CSS a hook for whole-scene flat mode, but a per-surface
float placement has none. Floating changes what design-space px mean, and the CSS written for
the projected case follows the content across — one integration ended up with 368px of content
inside a 312px clipping box, cut off on phones only.

The workaround is the argument for fixing it: subscribe to `image-surface-layout`, mirror each
surface's placement into local state, bind a class per slot. Every app with a float variant
writes that same boilerplate.

**Approach.** The information is already on the node: `data-placement` is set per surface, and
collapses a `{ rect }` placement to `'float'`. What is missing is a way to reach it from outside
the shadow root — `part` is a single static `surface`, and CSS Shadow Parts does not allow an
attribute selector after `::part()`. Emitting a second part name instead,
`part="surface surface-float"`, reduces the whole workaround to `::part(surface-float) { … }`.

Related, and worth fixing alongside: `computeLayout` returns a degenerate quad and `scale: 0`
for any non-projected surface, so the layout event carries no usable geometry for a floated
one — only its placement. That is *why* the workaround has to mirror state rather than read it.

## Framing solver in core

**The gap.** "Frame all surfaces" in Screens mode computes exactly what an app needs for the
full-page-background case: the framing that keeps every surface visible at a given aspect ratio.
It is locked inside the editor, so consumers hand-roll it.

**Approach.** Export something like `framingFor(manifest, { aspectRange })`, returning a
suggested `objectPosition`/`crop`. Most of the maths is already pure and DOM-free and would only
move: `expandCropToAspect`, and `visibleFraction` with its Sutherland-Hodgman clip and shoelace
area. Only the orchestrator is DOM-bound, and its algorithm is small — the bounding box of the
projected corners with 2% padding, expanded to the target aspect and clamped.

Core is the right home, and running in Node without a browser is the point: one integration
swept `object-position` across 120 aspect ratios offline before writing any markup.

## Documentation gaps

Content the README is missing, as opposed to the site above.

- **`clip: false` is an undocumented feature.** It appears once, as a bare line in the manifest
  sample, with no explanation — while the `resolution` line beside it gets one. Yet turning
  clipping off is how a glow spills past an object, or a label floats above a surface while
  still riding its perspective. Effects reachable no other way, currently found by accident.
- **The core runs headlessly, and nothing says so.** Zero dependencies and no DOM references
  reads as an implementation detail; it is really a feature. Worth a worked recipe — solving for
  an `object-position` across a range of aspect ratios in Node, before any markup exists.
- **Merged manifests.** That `manifest` takes an object rather than only a URL is the cheap
  answer to the ownership problem above, and is not written down anywhere.

The three traps are not on this list on purpose. An integration verified all three held; that
section is doing its job and should be left alone.

## Manifest tooling

- A JSON Schema published alongside the format, for editor autocomplete.
- A codegen step that turns a manifest into typed per-surface components, so
  `<LaptopScreen>` exists instead of a stringly-typed `slot="laptop-screen"`.
