# image-aware-elements

Render live HTML onto flat surfaces inside a photograph.

Mark the four corners of a laptop screen, a phone, a poster on a wall. Save a small
JSON file. Then put real DOM on that surface — text you can select, buttons you can
click, a whole app if you want — angled to match the photo.

```html
<image-surface src="/desk.jpg" manifest="/desk.surfaces.json" fit="cover">
  <div slot="laptop-screen">
    <h1>This is a real div.</h1>
  </div>
</image-surface>
```

Works in plain HTML, React, and Angular. Zero runtime dependencies.

---

## How it works

Mapping a rectangle onto an arbitrary convex quadrilateral is a **projective transform**
— a homography — and CSS `matrix3d()` expresses exactly that. So you never describe 3D
geometry. Four marked corners fully determine the perspective.

Given source corners `(u,v)` and destination corners `(x,y)`, solve eight coefficients
from eight linear equations:

```
x = (au + bv + c) / (gu + hv + 1)
y = (du + ev + f) / (gu + hv + 1)
```

then lay them into a CSS matrix:

```css
transform-origin: 0 0;
transform: matrix3d(a, d, 0, g,
                    b, e, 0, h,
                    0, 0, 1, 0,
                    c, f, 0, 1);
```

Three things about this are worth stating plainly, because each one is a trap:

- **Do not add CSS `perspective`.** The projective divide is already inside the matrix.
  A `perspective` on an ancestor applies it a second time and bends the result. This is
  the most common way the technique is got wrong.
- **`transform-origin: 0 0` is mandatory.** The homography maps the design rect's
  top-left onto the marked corner; any other origin silently offsets everything.
- **Resizing is O(1).** Scaling the container scales the destination corners, which
  scales six of the eight coefficients and leaves the other two alone. No re-solve, no
  matter how many surfaces the photo carries.

The whole transform is about fifty lines of dependency-free arithmetic. No WebGL, no
canvas, no matrix library. The surface stays real, selectable, focusable, accessible DOM.

## Quick start

### 1. Mark the surfaces

```bash
npx @image-aware/editor ./desk.jpg      # once published
pnpm mark ./desk.jpg                    # from a clone of this repo
```

Opens an editor on `http://localhost:5123`. Drag the four corners onto the surface — a
loupe magnifies the photo under the cursor so you can place them to the pixel — then
save. You get `desk.surfaces.json` next to the photo.

**Screens** mode renders the marking through the shipped element at a chosen viewport
preset, reports how much of each surface survives the crop and how small it renders, and
can solve for a crop that frames every surface. That is also where responsive framing and
per-surface placement are authored.

Arrow keys nudge by one pixel, shift+arrows by ten. The orientation sliders re-project a
true rectangle, so they cannot produce a shape that fails to render.

### 2. Render onto them

**Plain HTML**

```html
<script type="module" src="/node_modules/@image-aware/element/dist/auto.js"></script>

<image-surface src="/desk.jpg" manifest="/desk.surfaces.json" fit="cover">
  <div slot="laptop-screen">…anything…</div>
</image-surface>
```

**React**

```tsx
import { ImageSurface, Surface } from '@image-aware/react';
import manifest from './desk.surfaces.json';

<ImageSurface manifest={manifest} src="/desk.jpg" fit="cover">
  <Surface id="laptop-screen">
    <MyApp />
  </Surface>
</ImageSurface>;
```

**Angular**

```ts
bootstrapApplication(AppComponent, { providers: [provideImageAware()] });
```

```html
<image-surface [manifest]="manifest" src="/desk.jpg" fit="cover">
  <div slot="laptop-screen">…</div>
</image-surface>
```

There is no Angular wrapper component, deliberately. `<image-surface>` is a custom
element, so Angular binds to it directly — `[manifest]` becomes a property assignment,
which is exactly what the element wants. Add `CUSTOM_ELEMENTS_SCHEMA` to the component
that uses it. A wrapper would add a DOM node and a second layer of content projection
for no benefit.

## The manifest

```jsonc
{
  "version": 1,
  "image": { "src": "desk.jpg", "width": 4032, "height": 3024 },
  "surfaces": [
    {
      "id": "laptop-screen",          // the slot name you target from markup
      "corners": [                     // top-left, top-right, bottom-right, bottom-left
        [0.2625, 0.310],
        [0.6125, 0.255],
        [0.6563, 0.640],
        [0.2375, 0.590]
      ],
      "resolution": [1280, 800],       // design-space CSS px your content lays out against
      "clip": true,
      "z": 1
    }
  ]
}
```

Corners are **fractions of the image**, not pixels, so the manifest survives re-exporting
the photo at a different size. `resolution` is the coordinate space your slotted content
sees: write CSS as if the surface were a 1280×800 screen, and it gets projected.

An optional `variants` array re-frames the scene at different viewport sizes — see
[Responsive and mobile](#responsive-and-mobile).

## Responsive and mobile

Half of this is automatic and half of it cannot be, and the split is worth stating plainly
because it decides how you use the library.

**Automatic.** Surfaces are anchored to the *photo*, not to the element box, so they stay
locked to the thing they were marked onto at every container size and under every crop.
Resizing costs six multiplications per surface, not a re-solve.

**Not automatic.** A photograph is a fixed projection: the laptop screen is wherever the
camera put it, at whatever size the framing gave it. Take the 1616×1080 photo in
`fixtures/`, whose laptop screen spans x 0.518–0.884, onto a 390×844 phone under `cover`:
the photo scales to 1263×844 and the surface lands at x 217–680, so **most of it is off the
right-hand edge**, rendering at 0.72× — a 44px button becomes 32px before foreshortening.
No value of `object-position` fixes that, because a 462px-wide surface does not fit a 390px
viewport.

So responsiveness here is **art direction**, the same problem `<picture>` solves. You do
not reflow a photograph; you choose a different framing of it.

### Variants

Add a `variants` array to the manifest. Entries are evaluated in order, **first match
wins**, and an entry with no `media` always matches:

```jsonc
{
  "version": 1,
  "image": { "src": "desk.jpg", "width": 1616, "height": 1080 },
  "surfaces": [ /* … marked once … */ ],

  "variants": [
    // Phones: show this region of the photo, and move the badge off it into a
    // box on the screen while the menu drops below the picture entirely.
    {
      "media": "(max-width: 480px)",
      "crop": [0.53, -0.08, 0.36, 1.15],
      "placements": {
        "menu": "flow",
        "badge": { "rect": [0.575, 0.67, 0.36, 0.13] }
      }
    },

    // Tablets: same surfaces, just a tighter region of the photo. Corners are
    // fractions of the image, so nothing needs re-marking.
    { "media": "(max-width: 768px)", "crop": [0.35, -0.06, 0.55, 1.1] },

    // A different crop or shot. Different pixel dimensions mean different
    // fractions, so this one carries its own surfaces.
    {
      "media": "(orientation: portrait)",
      "image": { "src": "desk-portrait.jpg", "width": 1080, "height": 1440 },
      "surfaces": [ /* … marked against the portrait crop … */ ]
    }
  ]
}
```

**`crop`** is a region of the photo — `[x, y, width, height]` as fractions of the image —
scaled to cover the viewport and centred. It is the one framing control that can *zoom*:
`fit` and `objectPosition` pan the photo but cannot magnify it, which is what makes a small
surface unusable on a narrow screen. A crop is free to extend past the image, which simply
means the photo does not fill the viewport.

**`placements`** says what each surface does here, keyed by id: `"projected"` (the default),
`"flow"` (an ordinary block under the photo), `"none"` (dropped), or
`{ "rect": [x, y, w, h] }` to float it over the photo at a position in *viewport* fractions.
`"flat": true` is shorthand for giving every surface `"flow"`.

A variant inherits `image`, `surfaces`, `fit`, `crop`, `objectPosition` and `placements`
from the top level, which may set any of them as its own defaults.
Overriding `image` **requires** `surfaces` — reusing fractions against a differently shaped
photo silently drifts every surface, so it is an error rather than a guess. A variant may
also list *fewer* surfaces than the top level, which is how you drop an accent surface on
small screens; its slotted content simply stops rendering.

Nothing changes in your markup. The breakpoints live in the manifest, so the page stays
one `<image-surface manifest="/desk.surfaces.json">` and the app has no conditionals.

`variants` is additive under `version: 1`. Older readers ignore the key and render the top
level, which is the same graceful degradation `<picture>` gives.

### Flat mode

Below some width a projected surface is too small to touch, and the honest thing is to stop
pretending. A `flat` variant renders slotted content as ordinary blocks under the photo.

It is entirely opt-in — a manifest with no flat variant never goes flat — and a page can
overrule one it does not own with `flat="false"` on the element. The bare `flat` attribute
forces it on at any size.

While flat, the host carries a **`data-flat` attribute**, which is the hook your page CSS
needs, because design-space lengths mean nothing once the projection is gone:

```css
.menu a { font-size: 30px; }                              /* design-space px */
image-surface[data-flat] .menu a { font-size: 1.35rem; }  /* real page px */
```

**The one non-obvious gotcha:** if you pinned the element as a full-page background, undo
that when flat, or a fixed-position element will be holding a document that now has real
height:

```css
image-surface { position: fixed; inset: 0; }
image-surface[data-flat] { position: static; }
```

### Sizing content so it survives

- Write slotted CSS in the surface's **design space** (its `resolution`), not page pixels.
- Keep targets large in that space. The `image-surface-layout` event reports a `scale` per
  surface — the shortest projected edge over its design edge — so a 44px control really
  renders at `44 × scale`. It also reports `quad`, where the corners actually landed, which
  you can intersect with the container to see how much has been cropped away.
- A surface cropped out of frame **does not disappear**. Its transform stays correct, so it
  renders detached from the object it was marked onto — a floating box on the wrong part of
  the photo. Check your breakpoints rather than assuming it degrades quietly.

### Let the editor do the arithmetic

Finding `"85% 50%"` by hand is guesswork, and with two surfaces it is a constraint problem.
Switch the editor to **Screens**: pick a viewport preset and it shows how much of each
surface survives the crop and what a 44px control would actually render at. Drag the photo
to reframe it, or let **Frame all surfaces** solve for a crop that holds every surface at
that viewport.

## Packages

| Package | What it is |
| --- | --- |
| `@image-aware/core` | The maths: homography, pose, validation, layout. Zero dependencies, no DOM. |
| `@image-aware/element` | The `<image-surface>` custom element. |
| `@image-aware/react` | `<ImageSurface>` / `<Surface>` for React 18+. |
| `@image-aware/angular` | Registration provider and types for Angular 17+. |
| `@image-aware/editor` | The marking tool, as a CLI and a static page. |

Everything except `core` is a thin adapter; all the logic lives in `core`.

## Events

`image-surface-load`, `image-surface-layout`, `image-surface-error`.

Hyphenated rather than colon-namespaced on purpose: Angular's template parser reads `x:y`
in an event binding as `globalTarget:event` and rejects anything but `window`, `document`
or `body`, so a colon would make the event unbindable from an Angular template.

`image-surface-layout` fires on every recompute, including resizes and variant changes. Its
detail carries `layout` — `imageRect` plus, per surface, `matrix3d`, the projected `quad`
and its `scale` — and `variant`, which says which media-gated variant is on screen.

## Orientation

Corners are always the source of truth, but the editor can also show and edit the
surface's angle. `yaw`, `pitch` and `roll` behave like CSS `rotateY`, `rotateX` and
`rotateZ` — positive yaw pushes the right edge away, positive pitch pushes the top edge
away, positive roll turns clockwise on screen.

Recovering an angle from four corners is a best fit, so `compose(decompose(quad))` lands
near the original quad rather than exactly on it. The other direction is exact.

## Known limitations

- **Transformed text is rasterised then projected.** Raise a surface's `resolution` for
  crisper text. Do *not* set `will-change: transform` on a surface — in Chrome that pins
  the raster scale and makes text blurrier, not sharper.
- **Grazing angles alias.** A surface nearly edge-on gets heavily minified.
- **Small viewports need art direction, not reflow.** A surface cannot be made bigger than
  the photograph framed it, and one cropped out of frame renders detached rather than
  disappearing. See [Responsive and mobile](#responsive-and-mobile).
- **No occlusion.** Anything in the photo that should sit in *front* of the surface — a
  hand, a mug — will be painted over. See [ENHANCEMENTS.md](./ENHANCEMENTS.md).
- **The manifest's declared image size must match the file.** The browser's `object-fit`
  uses the file's real aspect ratio while the corner maths uses the declared one; a
  mismatch drifts content off the surface. The element warns when it spots this.
- Content is fully keyboard- and screen-reader-accessible, since it is real DOM, though
  focus rings and native form controls render transformed.

## Development

```bash
pnpm install
pnpm build

pnpm editor                    # editor on :5190, opens on the bundled fixture
pnpm mark ./your-photo.jpg     # editor on :5123, saves beside your photo

pnpm test         # unit tests (vitest)
pnpm test:e2e     # browser tests (playwright, all three engines)

# WebKit needs system libraries that some Linux/WSL setups lack. If it will not
# launch, install them with `pnpm exec playwright install --with-deps webkit`
# (needs sudo), or run the other two engines:
pnpm test:e2e --project=chromium --project=firefox

pnpm --filter @image-aware-example/vanilla dev   # :5180  landing page: menu on the photo,
                                                 #         art-directed crop, flat under 480px
pnpm --filter @image-aware-example/react dev     # :5181
pnpm --filter @image-aware-example/angular dev   # :5182
pnpm --filter @image-aware/editor dev            # :5190
```

The E2E suite measures where the browser *actually* paints each corner and compares it
against where the maths says it should be, to within a pixel. That is the check that
matters: a matrix can be arithmetically correct and still be laid into `matrix3d()` in
the wrong order.

Two fixtures, for two jobs:

- `fixtures/opportunities.jpg` — a real photograph of a laptop on a windowsill, used by
  all three examples. This is what the library is actually for.
- `fixtures/desk.svg` — a synthetic scene whose corner coordinates are exactly known,
  which is what lets the projection assertions be exact rather than approximate. Used by
  the E2E harness and by the editor when it opens in dev.

## License

MIT
