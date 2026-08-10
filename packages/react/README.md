# @image-aware/react

React bindings for [image-aware-elements](https://github.com/kneuroth/image-aware-elements):
render live HTML onto flat surfaces inside a photograph.

```tsx
import { ImageSurface, Surface } from '@image-aware/react';
import manifest from './desk.surfaces.json';

export function Hero() {
  return (
    <ImageSurface manifest={manifest} src="/desk.jpg" fit="cover">
      <Surface id="laptop-screen" className="screen">
        <h1>This is a real div.</h1>
        <button onClick={…}>And a real button.</button>
      </Surface>
    </ImageSurface>
  );
}
```

React 18+. The manifest prop accepts a raw JSON import directly — no cast needed, because
`import`ing JSON types `corners` as `number[][]` rather than a 4-tuple.

`<Surface>` renders a plain `<div slot={id}>`, so it stays in the light DOM and your
stylesheets apply as usual.

## Props

`ImageSurface`: `manifest`, `src`, `fit`, `objectPosition`, `flat`, `onLayout`, `onError`,
`className`, `style`, `ref`.

`onLayout(layout, variant)` fires on every recompute, including resizes and variant
changes. `layout` reports each surface's projected `quad` and `scale`, so you can tell how
large a control really renders; `variant` says which media-gated variant is on screen.

`flat` is usually better left undefined and driven by a `flat` variant in the manifest, so
the breakpoint lives with the marking rather than in app code. Pass `false` to overrule a
manifest that asks for flat.

Full documentation in the [project README](https://github.com/kneuroth/image-aware-elements#readme).

MIT
