import { makeEnvironmentProviders, provideAppInitializer, type EnvironmentProviders } from '@angular/core';
import { defineImageSurface } from '@image-aware/element';

/**
 * Register `<image-surface>` during application bootstrap.
 *
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [provideImageAware()],
 * });
 * ```
 *
 * Equivalent to `import '@image-aware/element/auto'` in `main.ts`; this form just
 * keeps the dependency visible alongside your other providers.
 */
export function provideImageAware(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAppInitializer(() => {
      defineImageSurface();
    }),
  ]);
}

export {
  EVENTS,
  defineImageSurface,
  TAG_NAME,
  type ActiveVariant,
  type ErrorEventDetail,
  type ImageSurfaceElement,
  type LayoutEventDetail,
} from '@image-aware/element';

export type {
  Layout,
  Manifest,
  ManifestInput,
  ManifestSource,
  ManifestVariant,
  ObjectFit,
  SurfaceLayout,
} from '@image-aware/core';
