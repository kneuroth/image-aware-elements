---
'@image-aware/core': minor
'@image-aware/element': minor
'@image-aware/react': minor
'@image-aware/angular': minor
'@image-aware/editor': minor
---

Initial release: render live HTML onto flat surfaces inside a photograph.

- `core` — homography solve, CSS `matrix3d` generation, O(1) responsive rescaling, quad
  validation, camera-pose recovery, `object-fit` geometry, and the v1 manifest format.
- `element` — the `<image-surface>` custom element, with named slots per surface.
- `react` / `angular` — thin framework bindings.
- `editor` — corner-marking tool with a magnifier loupe and orientation sliders, as both a
  CLI that saves in place and a static drag-and-drop page.

Responsiveness is art direction rather than reflow: a manifest may declare media-gated
`variants` that re-frame the photo, swap in a different crop, drop surfaces, or stop
projecting entirely on small screens. The layout event reports each surface's projected
size, and the editor's preview solves for a crop that frames every surface at a chosen
viewport — or says when none exists.
