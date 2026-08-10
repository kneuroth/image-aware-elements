import type { ImageSurfaceElement } from '@image-aware/element';
import type { CSSProperties, HTMLAttributes, Ref } from 'react';

/**
 * JSX typing for the underlying custom element.
 *
 * Deliberately attribute-shaped (`class`, `object-position`) rather than React's
 * camelCase props: React passes unknown props straight through to the DOM for
 * custom elements, so the attribute names are what actually land.
 */
export interface ImageSurfaceIntrinsicProps
  extends Omit<HTMLAttributes<HTMLElement>, 'className' | 'style'> {
  ref?: Ref<ImageSurfaceElement>;
  class?: string | undefined;
  style?: CSSProperties | undefined;
  src?: string;
  fit?: string;
  'object-position'?: string;
  /** Tri-state: `''` forces flat on, `'false'` forces it off, absent follows the manifest. */
  flat?: '' | 'false';
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'image-surface': ImageSurfaceIntrinsicProps;
    }
  }
}
