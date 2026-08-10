# @image-aware/angular

Angular bindings for [image-aware-elements](https://github.com/kneuroth/image-aware-elements):
render live HTML onto flat surfaces inside a photograph.

```ts
import { provideImageAware } from '@image-aware/angular';

bootstrapApplication(AppComponent, {
  providers: [provideImageAware()],
});
```

```ts
@Component({
  selector: 'app-hero',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <image-surface [manifest]="manifest" src="/desk.jpg" fit="cover"
                   (image-surface-layout)="onLayout($event)">
      <div class="screen" slot="laptop-screen">
        <h1>This is a real div.</h1>
      </div>
    </image-surface>
  `,
})
export class HeroComponent {
  readonly manifest: ManifestSource = manifest;
}
```

## Why there is no wrapper component

`<image-surface>` is a custom element, so Angular binds to it directly: `[manifest]`
becomes a DOM property assignment, which is exactly what the element expects. A wrapper
component would add a DOM node and a second layer of content projection without making
anything easier.

That is also why this package builds with plain `tsc` and needs no `ng-packagr` — it
contains no templates or decorators, just a provider and types.

## Responsive behaviour

Nothing Angular-specific: a manifest may declare `variants`, media-gated re-framings of the
scene, and the element swaps between them itself. Bind
`(image-surface-layout)="onLayout($event)"` to receive the active variant along with the
layout — the event names are hyphenated precisely so this binding is legal in a template.

See the [project README](https://github.com/kneuroth/image-aware-elements#responsive-and-mobile).

Angular 17+.

Full documentation in the [project README](https://github.com/kneuroth/image-aware-elements#readme).

MIT
