import type { CropRect, ObjectFit, Point, Rect, Size } from './types.js';

/**
 * Where an image actually lands inside its box under a given `object-fit`.
 *
 * This exists because of the background use case. With `object-fit: cover` the
 * photo is scaled up and cropped, so the rectangle the viewer sees is *not* the
 * element's box — it hangs off the edges. Surfaces are anchored to the photo, not
 * to the element, so every transform has to be built relative to this rect or the
 * content drifts off its surface as the window resizes.
 *
 * `position` is normalised (0..1) and mirrors CSS `object-position`, defaulting to
 * centred.
 */
export function contentRect(
  fit: ObjectFit,
  natural: Size,
  container: Size,
  position: Point = [0.5, 0.5],
): Rect {
  if (natural.width <= 0 || natural.height <= 0) {
    return { x: 0, y: 0, width: container.width, height: container.height };
  }

  if (fit === 'fill') {
    return { x: 0, y: 0, width: container.width, height: container.height };
  }

  const scaleX = container.width / natural.width;
  const scaleY = container.height / natural.height;
  const scale = fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

  const width = natural.width * scale;
  const height = natural.height * scale;

  return {
    x: (container.width - width) * position[0],
    y: (container.height - height) * position[1],
    width,
    height,
  };
}

/**
 * Where the photo must sit so that a chosen crop of it fills the container.
 *
 * `fit` plus `object-position` can pan the photo but cannot zoom into it, which
 * makes a small surface on a narrow viewport unsolvable. A crop rectangle says
 * "show this part of the photo here" directly, and is what art direction
 * actually wants: you place and size the region, rather than nudging a
 * percentage until it looks right.
 *
 * The crop is scaled to *cover* the container, so a container whose aspect ratio
 * differs from the crop's shows a little extra on one axis rather than
 * letterboxing. The crop's centre stays the container's centre.
 */
export function cropContentRect(crop: CropRect, natural: Size, container: Size): Rect {
  const [cx, cy, cw, ch] = crop;
  const width = cw * natural.width;
  const height = ch * natural.height;

  if (!(width > 0) || !(height > 0) || natural.width <= 0 || natural.height <= 0) {
    return { x: 0, y: 0, width: container.width, height: container.height };
  }

  const scale = Math.max(container.width / width, container.height / height);
  const painted = { width: natural.width * scale, height: natural.height * scale };

  return {
    x: container.width / 2 - (cx + cw / 2) * painted.width,
    y: container.height / 2 - (cy + ch / 2) * painted.height,
    width: painted.width,
    height: painted.height,
  };
}

/** Parse a CSS-ish `object-position` such as `"50% 50%"` or `"left top"`. */
export function parseObjectPosition(value: string | null | undefined): Point {
  if (!value) return [0.5, 0.5];
  const parts = value.trim().split(/\s+/);
  const x = parseAxis(parts[0], 'x');
  const y = parseAxis(parts[1] ?? '50%', 'y');
  return [x, y];
}

function parseAxis(token: string | undefined, axis: 'x' | 'y'): number {
  if (!token) return 0.5;
  const keywords: Record<string, number> = {
    left: 0,
    right: 1,
    top: 0,
    bottom: 1,
    center: 0.5,
  };
  const keyword = keywords[token.toLowerCase()];
  if (keyword !== undefined) {
    // `left`/`right` are meaningless on the y axis and vice versa; fall back to centre.
    const isHorizontal = token === 'left' || token === 'right';
    const isVertical = token === 'top' || token === 'bottom';
    if ((axis === 'x' && isVertical) || (axis === 'y' && isHorizontal)) return 0.5;
    return keyword;
  }
  if (token.endsWith('%')) {
    const n = Number.parseFloat(token);
    return Number.isFinite(n) ? n / 100 : 0.5;
  }
  return 0.5;
}
