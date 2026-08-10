import { ImageSurfaceElement } from './image-surface-element.js';

export const TAG_NAME = 'image-surface';

/**
 * Register `<image-surface>`.
 *
 * Idempotent, and safe to call from several packages at once — the React and
 * Angular wrappers both call it, and one app may use both. Also a no-op during
 * SSR, where `customElements` does not exist.
 *
 * Importing this module does NOT register anything; call this, or import
 * `@image-aware/element/auto` for the side effect.
 */
export function defineImageSurface(tagName: string = TAG_NAME): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(tagName)) return;
  customElements.define(tagName, ImageSurfaceElement);
}
