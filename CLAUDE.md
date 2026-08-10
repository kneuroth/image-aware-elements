# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pnpm + turbo monorepo that projects live HTML onto flat surfaces marked in a photograph,
using a homography laid into CSS `matrix3d()`. Read `README.md` first — it carries the maths,
the manifest format, and the three traps that break the technique (no ancestor `perspective`,
mandatory `transform-origin: 0 0`, O(1) resize).

## Commands

```bash
pnpm install
pnpm build          # turbo; every other task depends on ^build
pnpm check-types    # tsc --noEmit across all packages
pnpm test           # unit tests (vitest, in @image-aware/core and @image-aware/editor)
pnpm test:e2e       # playwright, chromium + firefox + webkit

# one test file / one test
pnpm --filter @image-aware/core exec vitest run test/homography.test.ts
pnpm --filter @image-aware/core exec vitest run -t 'name of the test'
pnpm test:e2e e2e/tests/projection.spec.ts --project=chromium

pnpm editor                    # editor on :5190 against the bundled fixture
pnpm mark ./photo.jpg          # editor CLI on :5123, writes photo.surfaces.json beside it
node scripts/screenshot.mjs http://localhost:5180/ out.png [w] [h] [--click sel]
```

There is no linter or formatter configured; `pnpm lint` does not exist.

Dev server ports are `strictPort`, one per app: vanilla 5180, react 5181, angular 5182,
editor 5190, e2e harness 5199, editor CLI 5123. Playwright starts the harness and the editor
itself, reusing an already-running server outside CI.

WebKit needs system libs some WSL/Linux setups lack; if it will not launch, run
`pnpm exec playwright install --with-deps webkit` or pass `--project=chromium --project=firefox`.

## Architecture

```
core  ──▶ element ──▶ react
   └──────┴─────────▶ angular
   └──────┴─────────▶ editor
```

`@image-aware/core` holds **all** the logic: homography solve, quad validation, pose
decomposition, object-fit, manifest parsing, layout. Zero dependencies and no DOM references
(`observeSize` guards on `typeof ResizeObserver`), so it is fully unit-testable in Node.
Everything else is a thin adapter — when adding behaviour, it almost always belongs in `core`,
not in an adapter. Angular and React ship as plain `tsc` output (no ng-packagr, no bundler).

### The two-phase layout pipeline

This split is the load-bearing design decision, spread across `core/src/layout.ts`,
`homography.ts`, and `element/src/image-surface-element.ts`:

1. `prepareManifest(manifest)` — once per manifest. Validates each quad and solves its
   homography against the **unit square**, not any pixel size. Does this for *every*
   variant, so crossing a breakpoint also costs no re-solve.
2. `selectVariant(prepared, matches)` — picks the media-gated variant. Takes a matcher
   rather than touching `matchMedia`, keeping the module DOM-free and testable in Node.
3. `computeLayout(variant, containerSize, fit, objectPosition)` — per resize. Pure function:
   `contentRect` for where `object-fit` puts the photo, then one `scaleHomography` +
   one `translateHomography`, then `toMatrix3d`. No re-solve.

`SurfaceLayout` also carries `quad` (projected corners in container px) and `scale`
(shortest projected edge ÷ design edge, deliberately the minimum — the crushed edge is what
decides legibility). Those two feed the editor's warnings and the docs' guidance.

Validation happens only in phase 1 because convexity and projective depth sign are invariant
under the later scale/translate. Because phase 2 is pure and DOM-free, the whole responsive
story is testable without a browser (`core/test/layout.test.ts`).

### Conventions that are easy to get wrong

- Corners are always `[top-left, top-right, bottom-right, bottom-left]` **of the unrotated
  design rect** — the order in which they map to `(0,0), (W,0), (W,H), (0,H)`.
- Manifest corners are fractions of the image (0..1), not pixels.
- `winding()` reports screen-space (y-down), so the canonical corner order reads as `cw`.
  The sign is deliberately flipped from the raw shoelace area; `sign-convention.test.ts`
  pins this and the yaw/pitch/roll signs against CSS `rotateY/rotateX/rotateZ`.
- `Homography` is 8 coefficients `[a,b,c,d,e,f,g,h]` with the 3x3's bottom-right normalised
  to 1.
- Pose is informational only. Corners always win; `compose(decompose(quad))` is approximate
  in that direction and exact in the other.

### The element

`<image-surface>` uses a shadow root for the `<img>` and one absolutely-positioned host div
per surface; each host wraps a named `<slot>`, so **user content stays in the light DOM** and
page CSS reaches it normally. The host is sized to the surface's `resolution` (its design-space
px) and gets the `matrix3d`.

At render time the element prefers the image's *natural* size over the manifest's declared
size, because that is what the browser's `object-fit` actually used; a >1% aspect mismatch
between the two logs a warning, since the failure mode (content drifting off-surface at some
container sizes only) is miserable to debug.

Events are hyphenated (`image-surface-load|layout|error`), never colon-namespaced: Angular's
template parser reads `x:y` in an event binding as `globalTarget:event` and rejects anything
but window/document/body.

**Responsiveness is art direction, not reflow.** A photograph is a fixed projection, so a
surface cannot be made bigger than the framing made it — see the worked numbers in the
README. The manifest's optional `variants` array is the mechanism (media-gated, first match
wins, inheriting from the top level; overriding `image` requires `surfaces`). Three things
here bite if forgotten:

- `object-position` must resolve from **one** place. The element reads the CSS custom
  property first, then the attribute, then the variant, and applies that single value to
  both the `<img>` and the transform maths. They were once read from different sources,
  which drifted content off its surface.
- `flat` is tri-state: absent follows the manifest, present forces projection off,
  `flat="false"` forces it on. A plain boolean would make `flat="false"` mean "flat".
- While flat the host carries `data-flat`, the hook page CSS needs — both to restyle
  design-space lengths and to undo `position: fixed` on a background element.

### Adapters

- **React** assigns `manifest` as a *property* via a layout effect — objects cannot travel
  through attributes, and React 18 stringifies unknown props on custom elements. `<Surface>`
  renders nothing but `<div slot={id}>`.
- **Angular** intentionally has no wrapper component, only `provideImageAware()` (an app
  initializer that calls `defineImageSurface`). Consumers bind to the custom element directly
  with `CUSTOM_ELEMENTS_SCHEMA`. See `ENHANCEMENTS.md` for why a typed wrapper was deferred.
- `parseManifest` accepts the loose `ManifestInput` shape so a raw
  `import manifest from './x.surfaces.json'` (which TypeScript types as `number[][]`) can be
  passed without a cast; narrowing happens at runtime.

### Editor

`packages/editor` is a plain Vite app with a hand-rolled store (`state.ts`: `getState`,
`update`, `subscribe`) and a single top-level `render()` in `main.ts`. It runs in two modes:

- **Static** — dropzone, downloads the JSON. In dev it auto-loads the repo fixtures.
- **Session** — `bin/image-aware.js`, a deliberately dependency-free Node server that exposes
  `/api/session`, `/api/image`, and GET/PUT `/api/manifest`, writing back next to the photo.
  The CLI serves `dist/`, so `pnpm build` must have run.

Responsive framing is authored in **Screens mode**, the editor's second mode — which is why
`stage.ts` knows nothing about it, and `panels.ts` only adds a placement select per surface. `preview.ts` sizes a frame to a viewport
preset at true size (scaled only for display, so reported numbers are real), renders one
resolved variant with no media gating, and reports per-surface visibility and scale.
`media.ts` evaluates media queries against a hypothetical viewport and returns `null` for
features it cannot parse, so the UI says "pick manually" instead of guessing. Variants are
round-tripped from the **raw** JSON (`variantsFromRaw`), never the parsed manifest, which
resolves inheritance and appends a fallback; variants carrying their own image are kept
verbatim as `opaque` so saving cannot destroy them.

### Testing strategy

Unit tests (vitest) cover the maths: `packages/core/test/` for the transform, manifest and
variant selection, `packages/editor/test/` for the framing solver, polygon clipping and the
offline media-query matcher. The E2E suite exists for the one bug class they structurally
cannot catch: a matrix that is arithmetically right but laid into `matrix3d()` in the wrong
column order, or double-divided by an ancestor `perspective`.
`e2e/tests/projection.spec.ts` measures where the browser *actually* painted zero-sized probe
elements and compares against `__expected` from `core`, to within 1 CSS px, in all three
engines. Keep those assertions exact — that is why `fixtures/desk.svg` is a synthetic scene
with known corner coordinates (used by the harness and the editor's dev mode), while
`fixtures/opportunities.jpg` is the real photo the three examples render.

`e2e/tests/responsive.spec.ts` covers what unit tests cannot reach either: that the photo and
the surfaces agree about the crop (they are applied through entirely different mechanisms),
that variants swap on a real viewport resize, and that flat mode drops the transform. It
drives `e2e/harness/responsive.html`, which is viewport-pinned because media queries answer
to the viewport, not to any element's box.

`desk.surfaces.json` has two surfaces (`laptop-screen`, `phone-screen`);
`desk.responsive.surfaces.json` adds variants for the responsive specs;
`opportunities.surfaces.json` has two (`laptop-screen` 646x432, `cube-face` 92x106) plus the
variants the landing-page example uses. Slotted content is styled in the surface's own
design-space px, so the CSS in an example is tied to that resolution — switching an example
between fixtures means rescaling it.

Fixtures live at the repo root and are wired in as each app's Vite `publicDir`, so every
example, the editor, and the harness render byte-identical scenes without duplicating assets.
The editor excludes them from its published build.

## Release

Changesets, with `@image-aware/*` version-locked together (`fixed`) and `@image-aware-example/*`
ignored. Add a changeset for any user-facing change; `pnpm release` builds then publishes.

## Gotchas

- `pnpm-workspace.yaml` declares `allowBuilds` explicitly — the Angular CLI shells out to pnpm
  for a dependency check and treats a non-zero exit as fatal, so unanswered build prompts break
  `ng serve`.
- tsconfig is strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`: indexed access
  yields `T | undefined` (hence the `!` throughout array-heavy math), type-only imports need
  `import type`, and relative imports must carry the `.js` extension.
