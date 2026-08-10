# @image-aware/element

The `<image-surface>` custom element: render live HTML onto flat surfaces inside a
photograph. Works in plain HTML/JS and anywhere custom elements do.

```html
<script type="module" src="/node_modules/@image-aware/element/dist/auto.js"></script>

<image-surface src="/desk.jpg" manifest="/desk.surfaces.json" fit="cover">
  <div slot="laptop-screen">
    <h1>This is a real div.</h1>
  </div>
</image-surface>
```

Slot names match surface ids in the manifest. Slotted content stays in the light DOM, so
your own CSS reaches it normally — nothing inside needs to know it is being projected.

## Entry points

- `@image-aware/element` — exports `ImageSurfaceElement` and `defineImageSurface()`. No
  side effects.
- `@image-aware/element/auto` — registers `<image-surface>` on import.

## Attributes and properties

| | |
| --- | --- |
| `src` | Photo URL. Defaults to the manifest's own `image.src`. |
| `manifest` | URL string (attribute) or manifest object (property). |
| `fit` | `contain` \| `cover` \| `fill`. |
| `object-position` | As CSS, e.g. `"50% 20%"`. |
| `flat` | Tri-state. Absent follows the manifest; present forces projection off; `flat="false"` forces it on. |
| `.layout` | The current computed layout, or `null`. |
| `.variant` | Which media-gated variant is on screen, or `null`. |

`--image-aware-object-position` overrides the attribute, so a plain `@media` rule can move
the crop. The photo and the transform maths always resolve it from the same place; setting
one without the other used to drift content off its surface.

## Responsive behaviour

A manifest may declare `variants` — media-gated re-framings of the scene. The element binds
a `matchMedia` per variant and swaps on change, having solved all of them up front, so
crossing a breakpoint costs no re-solve.

A `flat` variant stops projecting and lays slotted content out as ordinary blocks. While
flat, the host carries a `data-flat` attribute; use it to restyle slotted content, whose
design-space lengths no longer mean anything, and to undo any `position: fixed` you gave
the element as a background.

See the [project README](https://github.com/kneuroth/image-aware-elements#responsive-and-mobile).

## Events

`image-surface-load`, `image-surface-layout`, `image-surface-error`.

Hyphenated rather than colon-namespaced so they stay bindable from Angular templates,
where `x:y` is parsed as a global event target.

The layout detail carries `layout` — `imageRect`, and per surface its `matrix3d`, projected
`quad` and `scale` — plus the active `variant`.

Full documentation in the [project README](https://github.com/kneuroth/image-aware-elements#readme).

MIT
