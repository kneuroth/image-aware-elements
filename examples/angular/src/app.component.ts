import { CUSTOM_ELEMENTS_SCHEMA, Component, signal } from '@angular/core';
import type { Layout, ManifestSource } from '@image-aware/angular';
import manifest from '../../../fixtures/opportunities.surfaces.json';

/**
 * There is no wrapper component to import.
 *
 * `<image-surface>` is a custom element, so Angular binds to it directly:
 * `[manifest]` becomes a DOM property assignment, which is exactly what the
 * element wants. `CUSTOM_ELEMENTS_SCHEMA` tells the template compiler the tag is
 * intentional. A wrapper component would add a DOM node and an extra layer of
 * content projection for no benefit.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <header>
      <h1>Angular</h1>
      <p>The same manifest and photo as the other examples, driven by signals.</p>
    </header>

    <main>
      <image-surface
        [manifest]="manifest"
        src="/opportunities.jpg"
        fit="contain"
        (image-surface-layout)="onLayout($event)"
      >
        <div class="screen" slot="laptop-screen">
          <h2>Rendered by Angular.</h2>
          <p>Signal updates repaint inside the perspective, with no re-solve of the transform.</p>
          <button type="button" (click)="count.set(count() + 1)">
            Clicked {{ count() }} times
          </button>
          <span class="readout">{{ readout() }}</span>
        </div>
      </image-surface>
    </main>
  `,
})
export class AppComponent {
  // A raw JSON import types corners as number[][], which ManifestSource accepts.
  readonly manifest: ManifestSource = manifest;
  readonly count = signal(0);
  readonly readout = signal('measuring…');

  onLayout(event: Event): void {
    const { layout } = (event as CustomEvent<{ layout: Layout }>).detail;
    this.readout.set(
      `photo ${Math.round(layout.imageRect.width)} x ${Math.round(layout.imageRect.height)} px`,
    );
  }
}
