import { defineImageSurface, type ImageSurfaceElement, type Layout } from '@image-aware/element';
import type { CropRect } from '@image-aware/core';
import { expandCropToAspect, visibleFraction } from './geometry.js';
import { mediaMatches } from './media.js';
import {
  PREVIEW_PRESETS,
  editFraming,
  framingForPreset,
  getState,
  previewPreset,
  toPreviewManifest,
  update,
  variantForPreset,
  type EditorFraming,
  type EditorState,
  type PreviewPreset,
} from './state.js';

const holder = document.querySelector<HTMLElement>('#preview-holder')!;
const presetBar = document.querySelector<HTMLElement>('#preview-presets')!;
const stage = document.querySelector<HTMLElement>('#preview-stage')!;
const scaler = document.querySelector<HTMLElement>('#preview-scaler')!;
const frame = document.querySelector<HTMLElement>('#preview-frame')!;
const report = document.querySelector<HTMLElement>('#preview-report')!;
const framingPanel = document.querySelector<HTMLElement>('#framing')!;

/** Alignment grid for floating boxes: twentieths, so 25% and 50% land on a line. */
const GRID = 0.05;
/** How close an edge has to be, in viewport fractions, before it snaps. */
const SNAP = 0.014;
const MIN_FLOAT = 0.05;
/** Zoomed all the way in, and all the way out to a photo lost in the frame. */
const MIN_CROP = 0.02;
const MAX_CROP = 12;

let element: ImageSurfaceElement | null = null;
let lastLayout: Layout | null = null;
let displayScale = 1;
/**
 * A message that outlives the next layout. Writing it straight into the report
 * would work until the element laid out again — which changing the crop always
 * causes — and silently wiped it.
 */
let notice: string | null = null;

export function renderPreview(state: EditorState): void {
  if (state.mode !== 'preview' || !state.image) {
    holder.hidden = true;
    framingPanel.hidden = true;
    return;
  }

  defineImageSurface();
  holder.hidden = false;
  framingPanel.hidden = false;

  const preset = previewPreset();
  const framing = framingForPreset(state, preset, mediaMatches);

  renderPresets(state);
  renderFramingPanel(state, preset);
  renderFrame(state, framing);
}

function renderPresets(state: EditorState): void {
  presetBar.replaceChildren();

  for (const preset of PREVIEW_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn preset';
    button.setAttribute('aria-pressed', String(preset.id === state.previewPresetId));

    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = preset.label;

    const size = document.createElement('span');
    size.className = 'preset-size';
    size.textContent = `${preset.width}×${preset.height}`;
    button.append(name, size);

    // A dot marks a viewport that has framing of its own, so the row doubles as
    // an overview of which sizes have been dealt with.
    if (preset.breakpoint !== null && variantForPreset(state, preset, mediaMatches)) {
      button.classList.add('has-variant');
    }

    button.addEventListener('click', () => {
      notice = null;
      update((draft) => {
        draft.previewPresetId = preset.id;
      });
    });
    presetBar.append(button);
  }
}

/** The right rail in Screens mode: everything about how this viewport is framed. */
function renderFramingPanel(state: EditorState, preset: PreviewPreset): void {
  framingPanel.replaceChildren();

  const title = document.createElement('h2');
  title.className = 'rail-title';
  title.textContent = 'Framing';

  const summary = document.createElement('p');
  summary.className = 'preview-summary';
  const variant = preset.breakpoint === null ? null : variantForPreset(state, preset, mediaMatches);

  if (preset.breakpoint === null) {
    summary.textContent = 'The base. Used by any screen wider than the next size down.';
  } else {
    summary.textContent = variant
      ? `Applies below ${preset.breakpoint}px.`
      : `Applies below ${preset.breakpoint}px — inheriting until you change something.`;
  }

  const label = document.createElement('div');
  label.className = 'field-label';
  label.textContent = 'Photo';

  const frameAll = document.createElement('button');
  frameAll.type = 'button';
  frameAll.className = 'btn btn-block';
  frameAll.textContent = 'Frame all surfaces';
  frameAll.addEventListener('click', () => frameAllSurfaces(preset));

  const whole = document.createElement('button');
  whole.type = 'button';
  whole.className = 'btn btn-block';
  whole.textContent = 'Whole photo';
  whole.addEventListener('click', () => {
    notice = null;
    editFraming(preset, mediaMatches, (target) => {
      target.crop = null;
    });
  });

  framingPanel.append(title, summary, divider(), label, frameAll, whole);

  if (variant) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn-block';
    clear.textContent = 'Clear this size';
    clear.addEventListener('click', () => {
      notice = null;
      update((draft) => {
        draft.variants = draft.variants.filter((entry) => entry.key !== variant.key);
      }, { dirty: true });
    });
    framingPanel.append(divider(), clear);
  }
}

function divider(): HTMLElement {
  const line = document.createElement('div');
  line.className = 'divider';
  return line;
}

function frameAllSurfaces(preset: PreviewPreset): void {
  const state = getState();
  if (!state.image) return;
  notice = null;

  const framing = framingForPreset(state, preset, mediaMatches);
  const visible = state.surfaces.filter((surface) => {
    const placement = framing.placements[surface.id];
    return placement === undefined || placement === 'projected';
  });

  if (visible.length === 0) {
    flash('Nothing is projected at this size, so there is nothing to frame.');
    return;
  }

  const xs = visible.flatMap((surface) => surface.corners.map(([x]) => x));
  const ys = visible.flatMap((surface) => surface.corners.map(([, y]) => y));
  const pad = 0.02;
  const bounds: CropRect = [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) - Math.min(...xs) + pad * 2,
    Math.max(...ys) - Math.min(...ys) + pad * 2,
  ];
  // The crop is covered into the viewport, so it has to match its shape first or
  // the excess axis is simply cut off.
  const crop = clampCrop(expandCropToAspect(bounds, state.image, preset));

  editFraming(preset, mediaMatches, (target) => {
    target.crop = crop;
  });

  if (crop[0] < 0 || crop[1] < 0 || crop[0] + crop[2] > 1 || crop[1] + crop[3] > 1) {
    flash(
      `Framed, but the photo does not fill ${preset.width}×${preset.height} — there is empty ` +
        `space around it. Zoom in and drop a surface if you need full bleed.`,
    );
  }
}

function renderFrame(state: EditorState, framing: EditorFraming): void {
  const preset = previewPreset();
  const manifest = toPreviewManifest(state, framing);
  if (!manifest || !state.image) return;

  if (!element) {
    element = document.createElement('image-surface') as ImageSurfaceElement;
    element.addEventListener('image-surface-layout', (event) => {
      lastLayout = (event as CustomEvent<{ layout: Layout }>).detail.layout;
      renderReport();
    });
    frame.append(element);
    frame.title = 'Drag to move the photo, scroll to zoom';
    attachFramingGestures();
  }

  const available = {
    width: Math.max(120, stage.clientWidth - 24),
    height: Math.max(120, stage.clientHeight - 24),
  };
  displayScale = Math.min(1, available.width / preset.width, available.height / preset.height);

  frame.style.width = `${preset.width}px`;
  frame.style.height = `${preset.height}px`;
  frame.style.transform = `scale(${displayScale})`;
  scaler.style.width = `${preset.width * displayScale}px`;
  scaler.style.height = `${preset.height * displayScale}px`;
  scaler.dataset['scale'] = `${preset.width} × ${preset.height} · ${Math.round(displayScale * 100)}%`;

  element.setAttribute('src', state.image.url);
  element.setAttribute('fit', framing.fit || 'contain');
  element.removeAttribute('flat');

  const wanted = manifest.surfaces.map((surface) => surface.id).join(' ');
  if (element.dataset['surfaces'] !== wanted) {
    element.dataset['surfaces'] = wanted;
    element.replaceChildren(
      ...manifest.surfaces.map((surface) =>
        patternFor({
          id: surface.id,
          resolution: [surface.resolution[0], surface.resolution[1]],
        }),
      ),
    );
  } else {
    for (const surface of manifest.surfaces) {
      const node = element.querySelector<HTMLElement>(
        `[slot="${cssEscape(surface.id)}"] .pattern-res`,
      );
      if (node) node.textContent = `${surface.resolution[0]} × ${surface.resolution[1]}`;
    }
  }

  // Re-preparing the manifest on every keystroke would re-solve every surface and
  // reset the element, so only hand it over when it has actually changed.
  const signature = JSON.stringify(manifest);
  if (element.dataset['signature'] !== signature) {
    element.dataset['signature'] = signature;
    element.manifest = manifest;
  }

  renderFloatBoxes(state, framing);
}

/* -------------------------------------------------------------------------- */
/* Floating boxes                                                             */
/* -------------------------------------------------------------------------- */

type FloatHandle = 'nw' | 'ne' | 'se' | 'sw';

let floatLayer: HTMLElement | null = null;
let floatDrag: {
  id: string;
  mode: 'move' | FloatHandle;
  startX: number;
  startY: number;
  rect: CropRect;
} | null = null;
/** Lines the current drag snapped to, drawn as guides while it lasts. */
let guides: { x: number | null; y: number | null } = { x: null, y: null };

/**
 * Draggable boxes for floating surfaces.
 *
 * The handlers live on the layer rather than on each box, because every state
 * change rebuilds the boxes — and a pointer capture on a node that is about to be
 * replaced dies mid-drag. The layer survives, so the drag does.
 */
function ensureFloatLayer(): HTMLElement {
  if (floatLayer) return floatLayer;

  const layer = document.createElement('div');
  layer.className = 'preview-float-layer';
  frame.append(layer);
  floatLayer = layer;

  layer.addEventListener('pointerdown', (event) => {
    const box = (event.target as HTMLElement).closest<HTMLElement>('[data-float-id]');
    if (!box) return;

    // Otherwise this would also start a photo pan on the frame beneath.
    event.stopPropagation();
    const id = box.dataset['floatId']!;
    const rect = floatRectFor(id);
    if (!rect) return;

    const handle = (event.target as HTMLElement).dataset['handle'] as FloatHandle | undefined;
    floatDrag = { id, mode: handle ?? 'move', startX: event.clientX, startY: event.clientY, rect };
    layer.setPointerCapture(event.pointerId);
    layer.classList.add('is-dragging');
  });

  layer.addEventListener('pointermove', (event) => {
    if (!floatDrag) return;
    const preset = previewPreset();
    const dx = (event.clientX - floatDrag.startX) / displayScale / preset.width;
    const dy = (event.clientY - floatDrag.startY) / displayScale / preset.height;

    const moved = resizeFloat(floatDrag.rect, floatDrag.mode, dx, dy);
    // Alt is the usual escape hatch for "put it exactly where I said".
    const next = event.altKey ? clearGuides(moved) : snapFloat(moved, floatDrag.mode);
    const id = floatDrag.id;
    editFraming(previewPreset(), mediaMatches, (target) => {
      target.placements[id] = { rect: next };
    });
  });

  const end = (event: PointerEvent) => {
    if (!floatDrag) return;
    floatDrag = null;
    guides = { x: null, y: null };
    layer.releasePointerCapture(event.pointerId);
    layer.classList.remove('is-dragging');
    update(() => {});
  };
  layer.addEventListener('pointerup', end);
  layer.addEventListener('pointercancel', end);

  return layer;
}

function clearGuides(rect: CropRect): CropRect {
  guides = { x: null, y: null };
  return rect;
}

/** Nearest grid line, if the value is close enough to one. */
function snapTo(value: number): number | null {
  const nearest = Math.round(value / GRID) * GRID;
  return Math.abs(nearest - value) <= SNAP ? nearest : null;
}

/**
 * Pull a box onto the alignment grid.
 *
 * Moving considers leading edge, centre and trailing edge, and takes whichever is
 * closest — that is what makes centring feel automatic, since the centre snaps to
 * 50% without anyone lining an edge up by eye. Resizing snaps only the edge under
 * the cursor, because the opposite one is not moving.
 */
function snapFloat(rect: CropRect, mode: 'move' | FloatHandle): CropRect {
  const [x, y, width, height] = rect;
  guides = { x: null, y: null };

  const axis = (start: number, extent: number, moving: 'start' | 'end' | null) => {
    if (moving === null) {
      let best: { delta: number; line: number } | null = null;
      for (const value of [start, start + extent / 2, start + extent]) {
        const line = snapTo(value);
        if (line === null) continue;
        const delta = line - value;
        if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, line };
      }
      return best ? { start: start + best.delta, extent, line: best.line } : null;
    }

    const edge = moving === 'start' ? start : start + extent;
    const line = snapTo(edge);
    if (line === null) return null;
    return moving === 'start'
      ? { start: line, extent: Math.max(MIN_FLOAT, start + extent - line), line }
      : { start, extent: Math.max(MIN_FLOAT, line - start), line };
  };

  const horizontal = axis(
    x,
    width,
    mode === 'move' ? null : mode === 'nw' || mode === 'sw' ? 'start' : 'end',
  );
  const vertical = axis(
    y,
    height,
    mode === 'move' ? null : mode === 'nw' || mode === 'ne' ? 'start' : 'end',
  );

  if (horizontal) guides.x = horizontal.line;
  if (vertical) guides.y = vertical.line;

  return [
    horizontal?.start ?? x,
    vertical?.start ?? y,
    horizontal?.extent ?? width,
    vertical?.extent ?? height,
  ];
}

function floatRectFor(id: string): CropRect | null {
  const framing = framingForPreset(getState(), previewPreset(), mediaMatches);
  const placement = framing.placements[id];
  return placement && typeof placement !== 'string' ? placement.rect : null;
}

/** Move or resize a rect, keeping it inside the viewport and above a usable size. */
function resizeFloat(rect: CropRect, mode: 'move' | FloatHandle, dx: number, dy: number): CropRect {
  let [x, y, width, height] = rect;

  if (mode === 'move') {
    x += dx;
    y += dy;
  } else {
    if (mode === 'nw' || mode === 'sw') {
      const shift = Math.min(dx, width - MIN_FLOAT);
      x += shift;
      width -= shift;
    } else {
      width += dx;
    }
    if (mode === 'nw' || mode === 'ne') {
      const shift = Math.min(dy, height - MIN_FLOAT);
      y += shift;
      height -= shift;
    } else {
      height += dy;
    }
  }

  width = Math.min(1, Math.max(MIN_FLOAT, width));
  height = Math.min(1, Math.max(MIN_FLOAT, height));
  return [
    Math.min(Math.max(0, x), 1 - width),
    Math.min(Math.max(0, y), 1 - height),
    width,
    height,
  ];
}

function renderFloatBoxes(state: EditorState, framing: EditorFraming): void {
  const layer = ensureFloatLayer();
  layer.replaceChildren();
  // Handles are drawn in frame pixels but seen through the display scale, so
  // scale them up to stay grabbable at any zoom.
  layer.style.setProperty('--handle', `${Math.round(11 / displayScale)}px`);
  layer.style.setProperty('--grid', `${GRID * 100}%`);

  for (const axis of ['x', 'y'] as const) {
    const at = guides[axis];
    if (at === null) continue;
    const guide = document.createElement('span');
    guide.className = `preview-guide is-${axis}`;
    guide.style[axis === 'x' ? 'left' : 'top'] = `${at * 100}%`;
    layer.append(guide);
  }

  for (const surface of state.surfaces) {
    const placement = framing.placements[surface.id];
    if (!placement || typeof placement === 'string') continue;

    const [x, y, width, height] = placement.rect;
    const box = document.createElement('div');
    box.className = 'preview-float';
    box.dataset['floatId'] = surface.id;
    box.style.left = `${x * 100}%`;
    box.style.top = `${y * 100}%`;
    box.style.width = `${width * 100}%`;
    box.style.height = `${height * 100}%`;

    const label = document.createElement('span');
    label.className = 'preview-float-label';
    label.textContent =
      `${surface.id} · ${Math.round(x * 100)},${Math.round(y * 100)} · ` +
      `${Math.round(width * 100)}×${Math.round(height * 100)}`;
    box.append(label);

    for (const handle of ['nw', 'ne', 'se', 'sw'] as const) {
      const grip = document.createElement('span');
      grip.className = `preview-float-handle is-${handle}`;
      grip.dataset['handle'] = handle;
      box.append(grip);
    }

    layer.append(box);
  }
}

/* -------------------------------------------------------------------------- */
/* Photo framing gestures                                                     */
/* -------------------------------------------------------------------------- */

function attachFramingGestures(): void {
  let start: { x: number; y: number; crop: CropRect } | null = null;

  frame.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const crop = currentCrop();
    if (!crop) return;
    start = { x: event.clientX, y: event.clientY, crop };
    frame.setPointerCapture(event.pointerId);
    frame.classList.add('is-grabbing');
  });

  frame.addEventListener('pointermove', (event) => {
    if (!start || !lastLayout) return;
    const dx = (event.clientX - start.x) / displayScale;
    const dy = (event.clientY - start.y) / displayScale;

    // Moving the photo right means looking further left in it.
    applyCrop(
      clampCrop([
        start.crop[0] - dx / lastLayout.imageRect.width,
        start.crop[1] - dy / lastLayout.imageRect.height,
        start.crop[2],
        start.crop[3],
      ]),
    );
  });

  const end = (event: PointerEvent) => {
    if (!start) return;
    start = null;
    frame.releasePointerCapture(event.pointerId);
    frame.classList.remove('is-grabbing');
  };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);

  frame.addEventListener(
    'wheel',
    (event) => {
      const crop = currentCrop();
      if (!crop) return;
      event.preventDefault();

      const factor = Math.exp(event.deltaY * 0.0015);
      const rect = frame.getBoundingClientRect();
      // Zoom about the cursor, so the point under it stays put.
      const ax = (event.clientX - rect.left) / rect.width;
      const ay = (event.clientY - rect.top) / rect.height;

      const width = Math.min(MAX_CROP, Math.max(MIN_CROP, crop[2] * factor));
      const height = Math.min(MAX_CROP, Math.max(MIN_CROP, crop[3] * factor));
      applyCrop(
        clampCrop([
          crop[0] + (crop[2] - width) * ax,
          crop[1] + (crop[3] - height) * ay,
          width,
          height,
        ]),
      );
    },
    { passive: false },
  );
}

/** The region currently on screen, whether or not it was authored as a crop. */
function currentCrop(): CropRect | null {
  const state = getState();
  const preset = previewPreset();
  const framing = framingForPreset(state, preset, mediaMatches);
  if (framing.crop) return framing.crop;
  if (!lastLayout) return null;

  const { imageRect } = lastLayout;
  if (imageRect.width <= 0 || imageRect.height <= 0) return null;
  return clampCrop([
    -imageRect.x / imageRect.width,
    -imageRect.y / imageRect.height,
    preset.width / imageRect.width,
    preset.height / imageRect.height,
  ]);
}

function applyCrop(crop: CropRect): void {
  editFraming(previewPreset(), mediaMatches, (target) => {
    target.crop = crop;
  });
}

/**
 * Keep a crop usable without deciding where it may go.
 *
 * Only the extent is bounded, and generously: a crop is free to sit outside the
 * photo entirely. That is what "zoomed out" means here — the region shown is
 * larger than the image, so the photo floats with empty space around it, which is
 * a legitimate composition rather than a mistake to be clamped away.
 */
function clampCrop(crop: CropRect): CropRect {
  return [
    crop[0],
    crop[1],
    Math.min(MAX_CROP, Math.max(MIN_CROP, crop[2])),
    Math.min(MAX_CROP, Math.max(MIN_CROP, crop[3])),
  ];
}

/* -------------------------------------------------------------------------- */

/**
 * A calibration target rather than lorem ipsum: a 10x10 grid makes any residual
 * skew obvious, and text at a known size shows how legible real content will be
 * at this angle.
 */
function patternFor(surface: { id: string; resolution: [number, number] }): HTMLElement {
  const root = document.createElement('div');
  root.slot = surface.id;
  root.className = 'pattern';
  root.style.containerType = 'size';

  const id = document.createElement('div');
  id.className = 'pattern-id';
  id.textContent = surface.id;

  const res = document.createElement('div');
  res.className = 'pattern-res';
  res.textContent = `${surface.resolution[0]} × ${surface.resolution[1]}`;

  const foot = document.createElement('div');
  foot.className = 'pattern-foot';
  const left = document.createElement('span');
  left.textContent = 'grid = 10%';
  const right = document.createElement('span');
  right.textContent = 'live DOM';
  foot.append(left, right);

  const head = document.createElement('div');
  head.append(id, res);
  root.append(head, foot);
  return root;
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value;
}

/**
 * Say what the projection is actually doing at this size.
 *
 * Both numbers come from the element's own layout: how much of each surface
 * survives the crop, and how far its design pixels are being shrunk. A surface
 * that leaves the frame does not disappear — its transform stays correct and it
 * renders detached from the thing it was marked onto — so this is the only place
 * that failure becomes visible before shipping.
 */
function renderReport(): void {
  report.replaceChildren();
  if (notice) report.append(line(notice, 'warn'));
  if (!lastLayout) return;

  const preset = previewPreset();

  for (const surface of lastLayout.surfaces) {
    if (surface.placement !== 'projected') {
      const how =
        surface.placement === 'flow'
          ? 'below the photo'
          : surface.placement === 'none'
            ? 'hidden here'
            : 'floating over the photo';
      report.append(line(`${surface.id} — ${how}, not projected.`, 'ok'));
      continue;
    }

    const visible = visibleFraction(surface.quad, preset);
    const percent = Math.round(visible * 100);
    const target = Math.round(44 * surface.scale);

    if (visible < 0.02) {
      report.append(
        line(
          `${surface.id} — outside the frame entirely. It still renders, detached from the photo.`,
          'bad',
        ),
      );
    } else if (visible < 0.95) {
      report.append(
        line(`${surface.id} — only ${percent}% in frame; the rest is cropped away.`, 'bad'),
      );
    } else if (target < 32) {
      report.append(
        line(
          `${surface.id} — fully in frame but small: a 44px control renders at ${target}px.`,
          'warn',
        ),
      );
    } else {
      report.append(
        line(`${surface.id} — ${percent}% in frame, ${surface.scale.toFixed(2)}× scale.`, 'ok'),
      );
    }
  }
}

function line(text: string, tone: 'ok' | 'warn' | 'bad'): HTMLElement {
  const row = document.createElement('p');
  row.className = `preview-line is-${tone}`;
  row.textContent = text;
  return row;
}

function flash(message: string): void {
  notice = message;
  renderReport();
}
