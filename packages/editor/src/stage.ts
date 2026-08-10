import type { Point, Quad } from '@image-aware/core';
import {
  CORNER_NAMES,
  checkSurface,
  clampNormalised,
  replaceCorner,
  toPixels,
} from './geometry.js';
import { getState, selectedSurface, update, type EditorState } from './state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const well = document.querySelector<HTMLElement>('#well')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const photo = document.querySelector<HTMLImageElement>('#photo')!;
const overlay = document.querySelector<SVGSVGElement>('#overlay')!;
const loupe = document.querySelector<HTMLElement>('#loupe')!;
const loupePhoto = document.querySelector<HTMLImageElement>('#loupe-photo')!;

const LOUPE_SIZE = 136;
const LOUPE_ZOOM = 8;

let dragging: { surfaceId: string; corner: number } | null = null;
let panning: { startX: number; startY: number; originX: number; originY: number } | null = null;
let spaceHeld = false;

/** Convert a pointer event to intrinsic image pixels. */
function toImagePoint(event: PointerEvent | MouseEvent): Point | null {
  const { image } = getState();
  if (!image) return null;
  const rect = photo.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return [
    ((event.clientX - rect.left) / rect.width) * image.width,
    ((event.clientY - rect.top) / rect.height) * image.height,
  ];
}

export function renderStage(state: EditorState): void {
  const { image } = state;
  if (!image) return;

  stage.style.width = `${image.width}px`;
  stage.style.height = `${image.height}px`;
  stage.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  if (photo.src !== image.url) photo.src = image.url;
  if (loupePhoto.src !== image.url) loupePhoto.src = image.url;

  overlay.setAttribute('viewBox', `0 0 ${image.width} ${image.height}`);
  overlay.replaceChildren();

  // Paint unselected surfaces first so the active one is never occluded.
  const ordered = [...state.surfaces].sort((a, b) => {
    if (a.id === state.selectedId) return 1;
    if (b.id === state.selectedId) return -1;
    return a.z - b.z;
  });

  for (const surface of ordered) {
    const active = surface.id === state.selectedId;
    const pixels = toPixels(surface.corners, image);
    const check = checkSurface(surface);

    const group = el('g', { class: `quad${active ? ' is-active' : ''}${check.ok ? '' : ' is-invalid'}` });
    group.append(
      el('polygon', { class: 'quad-fill', points: pointsAttr(pixels) }),
      el('polygon', { class: 'quad-edge', points: pointsAttr(pixels) }),
    );

    const centroid = centre(pixels);
    const label = el('text', {
      class: 'quad-label',
      x: String(centroid[0]),
      y: String(centroid[1]),
      'text-anchor': 'middle',
      transform: `translate(${centroid[0]}, ${centroid[1]}) scale(${1 / state.zoom}) translate(${-centroid[0]}, ${-centroid[1]})`,
    });
    label.textContent = surface.id;
    group.append(label);

    if (active) {
      pixels.forEach((corner, index) => {
        group.append(handle(corner, index, state.zoom, state.activeCorner === index, surface.id));
      });
    }

    overlay.append(group);
  }

  renderLoupe(state);
}

/**
 * A corner handle: an open crosshair with a deliberate gap at the centre.
 *
 * Handles are counter-scaled by the current zoom so they stay a constant size on
 * screen — the point is to aim precisely, which gets harder if the target grows
 * as you zoom in.
 */
function handle(at: Point, index: number, zoom: number, active: boolean, surfaceId: string): SVGGElement {
  const group = el('g', {
    class: `handle${active ? ' is-active' : ''}`,
    transform: `translate(${at[0]}, ${at[1]}) scale(${1 / zoom})`,
    'data-corner': String(index),
    'data-surface': surfaceId,
  }) as SVGGElement;

  const arms: Array<[number, number, number, number]> = [
    [-15, 0, -5, 0],
    [5, 0, 15, 0],
    [0, -15, 0, -5],
    [0, 5, 0, 15],
  ];
  for (const [x1, y1, x2, y2] of arms) {
    group.append(
      el('line', { class: 'handle-arm', x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2) }),
    );
  }
  group.append(el('circle', { class: 'handle-ring', r: '15' }));
  group.append(el('circle', { class: 'handle-hit', r: '18' }));

  const tag = el('text', { class: 'handle-tag', x: '19', y: '-9' });
  tag.textContent = CORNER_NAMES[index] ?? '';
  group.append(tag);

  return group;
}

function renderLoupe(state: EditorState): void {
  const at = state.loupeAt;
  if (!at || !state.image || state.mode !== 'mark') {
    loupe.hidden = true;
    return;
  }

  const rect = photo.getBoundingClientRect();
  const wellRect = well.getBoundingClientRect();
  const screenX = rect.left + (at[0] / state.image.width) * rect.width - wellRect.left;
  const screenY = rect.top + (at[1] / state.image.height) * rect.height - wellRect.top;

  // Offset up-left of the cursor, flipping near the edges so it never leaves the well.
  const flipX = screenX + LOUPE_SIZE + 40 > wellRect.width;
  const flipY = screenY - LOUPE_SIZE - 28 < 0;
  loupe.style.left = `${screenX + (flipX ? -LOUPE_SIZE - 24 : 24)}px`;
  loupe.style.top = `${screenY + (flipY ? 24 : -LOUPE_SIZE - 24)}px`;

  loupePhoto.style.width = `${state.image.width * LOUPE_ZOOM}px`;
  loupePhoto.style.height = `${state.image.height * LOUPE_ZOOM}px`;
  loupePhoto.style.left = `${LOUPE_SIZE / 2 - at[0] * LOUPE_ZOOM}px`;
  loupePhoto.style.top = `${LOUPE_SIZE / 2 - at[1] * LOUPE_ZOOM}px`;
  loupe.hidden = false;
}

function moveCorner(surfaceId: string, index: number, imagePoint: Point): void {
  const { image } = getState();
  if (!image) return;
  const normalised = clampNormalised([imagePoint[0] / image.width, imagePoint[1] / image.height]);

  update((draft) => {
    const surface = draft.surfaces.find((s) => s.id === surfaceId);
    if (!surface) return;
    surface.corners = replaceCorner(surface.corners, index, normalised);
    draft.activeCorner = index;
    draft.loupeAt = imagePoint;
  }, { dirty: true });
}

export function initStage(): void {
  overlay.addEventListener('pointerdown', (event) => {
    const target = (event.target as Element).closest<SVGGElement>('.handle');
    if (!target || spaceHeld) return;
    const index = Number(target.dataset['corner']);
    const surfaceId = target.dataset['surface'];
    if (!surfaceId || Number.isNaN(index)) return;

    event.preventDefault();
    overlay.setPointerCapture(event.pointerId);
    dragging = { surfaceId, corner: index };
    update((draft) => {
      draft.activeCorner = index;
    });
  });

  overlay.addEventListener('pointermove', (event) => {
    const point = toImagePoint(event);
    if (!point) return;

    if (dragging) {
      event.preventDefault();
      moveCorner(dragging.surfaceId, dragging.corner, point);
      return;
    }

    update((draft) => {
      draft.cursor = { x: point[0], y: point[1] };
      // Show the loupe while hovering a handle, so you can see what you are about
      // to grab before committing to the drag.
      const hovered = (event.target as Element).closest('.handle');
      draft.loupeAt = hovered ? point : null;
    });
  });

  const endDrag = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = null;
    if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
    update((draft) => {
      draft.loupeAt = null;
    });
  };
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);

  well.addEventListener('pointerleave', () => {
    update((draft) => {
      draft.cursor = null;
      if (!dragging) draft.loupeAt = null;
    });
  });

  // Pan with space held, or with a middle-drag.
  well.addEventListener('pointerdown', (event) => {
    if (!spaceHeld && event.button !== 1) return;
    event.preventDefault();
    const { pan } = getState();
    panning = { startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y };
    well.classList.add('is-panning');
    well.setPointerCapture(event.pointerId);
  });

  well.addEventListener('pointermove', (event) => {
    if (!panning) return;
    const dx = event.clientX - panning.startX;
    const dy = event.clientY - panning.startY;
    update((draft) => {
      draft.pan = { x: panning!.originX + dx, y: panning!.originY + dy };
    });
  });

  const endPan = (event: PointerEvent) => {
    if (!panning) return;
    panning = null;
    well.classList.remove('is-panning');
    if (well.hasPointerCapture(event.pointerId)) well.releasePointerCapture(event.pointerId);
  };
  well.addEventListener('pointerup', endPan);
  well.addEventListener('pointercancel', endPan);

  // Zoom about the cursor so the pixel under the pointer stays put.
  well.addEventListener(
    'wheel',
    (event) => {
      if (!getState().image) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      zoomAbout(event.clientX, event.clientY, factor);
    },
    { passive: false },
  );

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !isTextEntry(event.target)) {
      spaceHeld = true;
      well.classList.add('can-pan');
      event.preventDefault();
      return;
    }
    handleNudge(event);
  });

  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
      spaceHeld = false;
      well.classList.remove('can-pan');
    }
  });
}

/** Arrow keys move the active corner by whole image pixels. */
function handleNudge(event: KeyboardEvent): void {
  if (isTextEntry(event.target)) return;
  const deltas: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const delta = deltas[event.key];
  if (!delta) return;

  const state = getState();
  const surface = selectedSurface();
  if (!surface || !state.image || state.activeCorner === null) return;

  event.preventDefault();
  const step = event.shiftKey ? 10 : 1;
  const index = state.activeCorner;
  const current = surface.corners[index]!;
  const point: Point = [
    current[0] * state.image.width + delta[0] * step,
    current[1] * state.image.height + delta[1] * step,
  ];
  moveCorner(surface.id, index, point);
}

function isTextEntry(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  return !!node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);
}

export function zoomAbout(clientX: number, clientY: number, factor: number): void {
  const state = getState();
  const next = clamp(state.zoom * factor, 0.05, 24);
  const wellRect = well.getBoundingClientRect();
  const localX = clientX - wellRect.left;
  const localY = clientY - wellRect.top;
  const ratio = next / state.zoom;

  update((draft) => {
    draft.pan = {
      x: localX - (localX - draft.pan.x) * ratio,
      y: localY - (localY - draft.pan.y) * ratio,
    };
    draft.zoom = next;
  });
}

export function zoomBy(factor: number): void {
  const rect = well.getBoundingClientRect();
  zoomAbout(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
}

/** Scale the photo to fit the well with a small margin, and centre it. */
export function zoomToFit(): void {
  const state = getState();
  if (!state.image) return;
  const rect = well.getBoundingClientRect();
  const margin = 48;
  const zoom = clamp(
    Math.min(
      (rect.width - margin) / state.image.width,
      (rect.height - margin) / state.image.height,
    ),
    0.05,
    24,
  );

  update((draft) => {
    draft.zoom = zoom;
    draft.pan = {
      x: (rect.width - state.image!.width * zoom) / 2,
      y: (rect.height - state.image!.height * zoom) / 2,
    };
  });
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function centre(quad: Quad): Point {
  return [
    (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4,
    (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4,
  ];
}

function pointsAttr(quad: Quad): string {
  return quad.map(([x, y]) => `${x},${y}`).join(' ');
}

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}
