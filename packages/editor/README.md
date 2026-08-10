# @image-aware/editor

Mark flat surfaces on a photo and export the manifest that
[`@image-aware/element`](https://www.npmjs.com/package/@image-aware/element) renders
against.

```bash
npx @image-aware/editor ./desk.jpg
```

Opens on `http://localhost:5123` and saves to `desk.surfaces.json`, next to the photo.
The same build also runs as a static page: drop a photo in, mark it, download the JSON.

```
  -p, --port <n>   Port to listen on (default 5123)
  -o, --open       Open a browser window
```

## Marking

Drag the four corners onto the surface, in the order top-left, top-right, bottom-right,
bottom-left. A loupe magnifies the photo under the cursor so corners can be placed to the
pixel, and the handles are open crosshairs rather than dots so they never cover the point
being placed.

- Arrow keys nudge the active corner by one image pixel, shift+arrows by ten.
- Scroll to zoom, space+drag to pan.
- The orientation sliders re-project a true rectangle, so they cannot produce a shape that
  fails to render.
- **Screens** renders the current marking through the real element runtime with a
  calibration grid, so what you see is what a consuming app will get.

## Screens

The editor has two modes. **Mark** is corner work on the photo. **Screens** lays the scene
out at a chosen viewport preset — desktop, laptop, tablet, phone — at true size, scaled
only for display, so every number it reports is what a real device would produce.

The preset *is* the breakpoint: pick Phone and you are editing what phones get. The media
query is derived, and the variant is created the moment you change something, so nobody
writes CSS by hand. Drag the photo to reframe it and scroll to zoom; each surface in the
left rail carries what it does at that size — on the photo, floating, below, or hidden.
A floating box snaps to a 5% grid with guides, centre included; hold Alt to place it
freely.

It reports, per surface, how much survives the crop and what a 44px control actually
renders at. A surface pushed out of frame does not disappear; its transform stays correct
and it renders detached from the object it was marked onto, which is the failure this panel
exists to catch before you ship it.

**Frame all surfaces** solves for a crop that keeps every surface in frame at that
viewport, and says when doing so leaves empty space around the photo.

A variant that brings its own image cannot be marked here yet. It is shown dashed and
written back exactly as found, so opening and saving a manifest never destroys one.

Quads that cross over themselves are flagged rather than exported quietly — the underlying
solver returns plausible-looking output for a bowtie, so this check is the difference
between an error and silently garbled rendering.

The CLI writes to disk; a malformed body is rejected before the file is touched, so a bad
save cannot clobber good work.

Full documentation in the [project README](https://github.com/kneuroth/image-aware-elements#readme).

MIT
