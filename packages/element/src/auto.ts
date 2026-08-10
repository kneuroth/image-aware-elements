/**
 * Side-effect entry point: registers `<image-surface>` on import.
 *
 * ```html
 * <script type="module" src="/node_modules/@image-aware/element/dist/auto.js"></script>
 * ```
 * ```js
 * import '@image-aware/element/auto';
 * ```
 */
import { defineImageSurface } from './define.js';

defineImageSurface();

export { defineImageSurface, TAG_NAME } from './define.js';
