import type { Layout, ManifestSource, ObjectFit } from '@image-aware/core';
import {
  defineImageSurface,
  type ActiveVariant,
  type ImageSurfaceElement,
} from '@image-aware/element';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';

export interface ImageSurfaceProps {
  /** A manifest object (a raw JSON import is fine), or a URL to fetch one from. */
  manifest: ManifestSource;
  /** Photo URL. Defaults to the manifest's own `image.src`. */
  src?: string;
  /** How the photo fills the element. Defaults to the manifest's `fit`, else `contain`. */
  fit?: ObjectFit;
  /** CSS `object-position`, e.g. `"50% 20%"`. */
  objectPosition?: string;
  /**
   * Stop projecting and lay slotted content out as ordinary blocks. Usually
   * better driven by a `flat` variant in the manifest, so the breakpoint lives
   * with the marking rather than in app code.
   *
   * Leave it undefined to follow the manifest; `false` overrules a manifest that
   * asks for flat and keeps the projection at every size.
   */
  flat?: boolean;
  /** Fired whenever transforms are recomputed, including on resize. */
  onLayout?: (layout: Layout, variant: ActiveVariant) => void;
  onError?: (error: Error) => void;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  ref?: Ref<ImageSurfaceElement>;
}

/**
 * `useLayoutEffect` warns during SSR. The element cannot do anything server-side
 * anyway, so fall back to `useEffect` where there is no DOM.
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Renders a photo and projects `<Surface>` children onto the flat surfaces marked
 * inside it.
 *
 * ```tsx
 * import manifest from './desk.surfaces.json';
 *
 * <ImageSurface manifest={manifest} fit="cover">
 *   <Surface id="laptop-screen">
 *     <MyApp />
 *   </Surface>
 * </ImageSurface>
 * ```
 */
export function ImageSurface({
  manifest,
  src,
  fit,
  objectPosition,
  flat,
  onLayout,
  onError,
  className,
  style,
  children,
  ref,
}: ImageSurfaceProps) {
  const innerRef = useRef<ImageSurfaceElement | null>(null);

  // Register before first paint so the element upgrades in the same frame it
  // mounts, avoiding a flash of untransformed content.
  useIsomorphicLayoutEffect(() => {
    defineImageSurface();
  }, []);

  // The manifest may be an object, and objects cannot travel through attributes.
  // Assigning the property directly also keeps this working on React 18, which
  // stringifies unknown props on custom elements.
  useIsomorphicLayoutEffect(() => {
    const node = innerRef.current;
    if (node) node.manifest = manifest;
  }, [manifest]);

  useEffect(() => {
    const node = innerRef.current;
    if (!node) return;

    const handleLayout = (event: Event) => {
      const { layout, variant } = (
        event as CustomEvent<{ layout: Layout; variant: ActiveVariant }>
      ).detail;
      onLayout?.(layout, variant);
    };
    const handleError = (event: Event) => {
      onError?.((event as CustomEvent<{ error: Error }>).detail.error);
    };

    node.addEventListener('image-surface-layout', handleLayout);
    node.addEventListener('image-surface-error', handleError);
    return () => {
      node.removeEventListener('image-surface-layout', handleLayout);
      node.removeEventListener('image-surface-error', handleError);
    };
  }, [onLayout, onError]);

  return (
    <image-surface
      ref={(node: ImageSurfaceElement | null) => {
        innerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      class={className}
      style={style}
      {...(src ? { src } : {})}
      {...(fit ? { fit } : {})}
      {...(objectPosition ? { 'object-position': objectPosition } : {})}
      {...(flat === undefined ? {} : { flat: flat ? ('' as const) : ('false' as const) })}
    >
      {children}
    </image-surface>
  );
}

export interface SurfaceProps {
  /** Must match a surface `id` in the manifest. */
  id: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Content for one marked surface.
 *
 * Renders a plain `<div slot={id}>`. It stays in the light DOM, so the app's own
 * CSS reaches it exactly as it would anywhere else on the page — nothing inside
 * needs to know it is being projected.
 */
export function Surface({ id, className, style, children }: SurfaceProps) {
  return (
    <div slot={id} className={className} style={style}>
      {children}
    </div>
  );
}
