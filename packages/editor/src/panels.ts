import { estimateResolution, type Pose } from '@image-aware/core';
import { CORNER_NAMES, aspectDrift, checkSurface, cornersAtPose, poseOf } from './geometry.js';
import { mediaMatches } from './media.js';
import {
  editFraming,
  framingForPreset,
  getState,
  previewPreset,
  selectedSurface,
  uniqueId,
  update,
  type EditorState,
  type EditorSurface,
} from './state.js';

/** Default box for a surface the first time it is set to float. */
const FLOAT_DEFAULT = [0.1, 0.62, 0.8, 0.16] as const;

const register = document.querySelector<HTMLOListElement>('#surface-list')!;
const inspector = document.querySelector<HTMLElement>('#inspector')!;
const statusCursor = document.querySelector<HTMLElement>('#status-cursor')!;
const statusValidity = document.querySelector<HTMLElement>('#status-validity')!;

/**
 * The pose the angle sliders are working from.
 *
 * Captured when a slider is first touched rather than re-derived on every input.
 * Recovering a pose from four corners is a best fit, so re-deriving each frame
 * would let rounding error accumulate and the surface would visibly creep while
 * dragging a single slider.
 */
let poseSession: Pose | null = null;

/** Rebuilt only when the selection changes, so typing in a field is never interrupted. */
let renderedForId: string | null = null;
let controls: InspectorControls | null = null;

interface InspectorControls {
  id: HTMLInputElement;
  label: HTMLInputElement;
  width: HTMLInputElement;
  height: HTMLInputElement;
  clip: HTMLInputElement;
  z: HTMLInputElement;
  coords: HTMLElement;
  sliders: Record<'yaw' | 'pitch' | 'roll', { input: HTMLInputElement; output: HTMLOutputElement }>;
  notice: HTMLElement;
}

export function renderPanels(state: EditorState): void {
  renderRegister(state);
  renderInspector(state);
  renderStatus(state);
}

function renderRegister(state: EditorState): void {
  register.replaceChildren();

  for (const surface of state.surfaces) {
    const item = document.createElement('li');
    item.className = 'register-item';
    item.tabIndex = 0;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(surface.id === state.selectedId));

    const swatch = document.createElement('span');
    swatch.className = 'swatch';

    const name = document.createElement('span');
    name.className = 'register-name';
    name.textContent = surface.id;

    item.append(swatch, name);

    // In Screens mode each surface carries what it does at the current viewport,
    // so the decision sits with the thing it applies to rather than in a separate
    // panel across the room. The design resolution steps aside for it — that is a
    // marking concern, and the name needs the room more.
    if (state.mode === 'preview') {
      item.append(placementSelect(surface.id, state));
    } else {
      const res = document.createElement('span');
      res.className = 'register-res';
      res.textContent = `${surface.resolution[0]}×${surface.resolution[1]}`;
      item.append(res);
    }

    if (!checkSurface(surface).ok) {
      const flag = document.createElement('span');
      flag.className = 'register-flag';
      flag.textContent = '!';
      flag.title = 'This quad cannot be rendered';
      item.append(flag);
    }

    const select = () => {
      poseSession = null;
      update((draft) => {
        draft.selectedId = surface.id;
        draft.activeCorner = null;
      });
    };
    item.addEventListener('click', select);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });

    register.append(item);
  }
}

/** Projected / floating / below / hidden, for one surface at the current preset. */
function placementSelect(id: string, state: EditorState): HTMLElement {
  const preset = previewPreset();
  const framing = framingForPreset(state, preset, mediaMatches);
  const current = framing.placements[id];
  const value =
    current === undefined || current === 'projected'
      ? 'projected'
      : typeof current === 'string'
        ? current
        : 'float';

  const select = document.createElement('select');
  select.className = 'input register-placement';
  select.setAttribute('aria-label', `${id} placement`);

  for (const [option, text] of [
    ['projected', 'On photo'],
    ['float', 'Floating'],
    ['flow', 'Below'],
    ['none', 'Hidden'],
  ] as const) {
    const node = document.createElement('option');
    node.value = option;
    node.textContent = text;
    node.selected = value === option;
    select.append(node);
  }

  // Selecting must not also select the surface for marking underneath.
  select.addEventListener('pointerdown', (event) => event.stopPropagation());
  select.addEventListener('click', (event) => event.stopPropagation());
  select.addEventListener('change', () => {
    editFraming(preset, mediaMatches, (target) => {
      const chosen = select.value;
      if (chosen === 'projected') {
        delete target.placements[id];
      } else if (chosen === 'float') {
        const existing = target.placements[id];
        target.placements[id] =
          existing && typeof existing !== 'string'
            ? existing
            : { rect: [...FLOAT_DEFAULT] as unknown as typeof FLOAT_DEFAULT };
      } else {
        target.placements[id] = chosen as 'flow' | 'none';
      }
    });
  });

  return select;
}

function renderInspector(state: EditorState): void {
  // The right rail belongs to framing in Screens mode.
  if (state.mode === 'preview') {
    inspector.hidden = true;
    return;
  }
  inspector.hidden = false;

  const surface = selectedSurface();

  if (!surface || !state.image) {
    renderedForId = null;
    controls = null;
    inspector.replaceChildren(emptyState(state));
    return;
  }

  if (renderedForId !== surface.id || !controls) {
    controls = buildInspector(surface);
    renderedForId = surface.id;
  }

  syncInspector(controls, surface, state);
}

function emptyState(state: EditorState): HTMLElement {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = state.image
    ? 'Select a surface, or add one to start marking.'
    : 'Open a photo to begin. Corners you mark are saved as fractions of the image.';
  return p;
}

function buildInspector(surface: EditorSurface): InspectorControls {
  inspector.replaceChildren();

  const title = document.createElement('h2');
  title.className = 'rail-title';
  title.textContent = 'Geometry';
  inspector.append(title);

  const id = textField('Slot name', surface.id, (value) => {
    update((draft) => {
      const target = draft.surfaces.find((s) => s.id === renderedForId);
      if (!target) return;
      const next = uniqueId(value.trim() || 'surface', draft.surfaces, target.id);
      target.id = next;
      draft.selectedId = next;
      renderedForId = next;
    }, { dirty: true });
  });

  const label = textField('Label', surface.label, (value) => {
    mutateSelected((target) => {
      target.label = value;
    });
  });

  inspector.append(id.field, label.field);

  inspector.append(divider());

  const coordsTitle = document.createElement('div');
  coordsTitle.className = 'field-label';
  coordsTitle.textContent = 'Corners (fraction of image)';
  const coords = document.createElement('div');
  coords.className = 'coords';
  inspector.append(coordsTitle, coords);

  inspector.append(divider());

  const resTitle = document.createElement('div');
  resTitle.className = 'field-label';
  resTitle.textContent = 'Design resolution (css px)';
  const pair = document.createElement('div');
  pair.className = 'pair';
  // Typing a resolution is an explicit choice, so it stops tracking the quad.
  const width = numberInput(surface.resolution[0], (value) => {
    mutateSelected((target) => {
      target.resolution = [value, target.resolution[1]];
      target.autoResolution = false;
    });
  });
  const height = numberInput(surface.resolution[1], (value) => {
    mutateSelected((target) => {
      target.resolution = [target.resolution[0], value];
      target.autoResolution = false;
    });
  });
  pair.append(width, height);

  const matchButton = document.createElement('button');
  matchButton.type = 'button';
  matchButton.className = 'btn btn-block';
  matchButton.textContent = 'Match quad size';
  matchButton.addEventListener('click', () => {
    const image = getState().image;
    if (!image) return;
    mutateSelected((target) => {
      const [w, h] = estimateResolution(target.corners, image);
      target.resolution = [w, h];
      target.autoResolution = true;
    });
  });

  inspector.append(resTitle, pair, matchButton);

  inspector.append(divider());

  const poseTitle = document.createElement('div');
  poseTitle.className = 'field-label';
  poseTitle.textContent = 'Orientation';
  inspector.append(poseTitle);

  const sliders = {
    yaw: slider('yaw', -85, 85),
    pitch: slider('pitch', -85, 85),
    roll: slider('roll', -180, 180),
  };
  inspector.append(sliders.yaw.row, sliders.pitch.row, sliders.roll.row);

  inspector.append(divider());

  const clip = checkbox('Clip content to surface', surface.clip, (value) => {
    mutateSelected((target) => {
      target.clip = value;
    });
  });
  inspector.append(clip.wrapper);

  const zField = textField('Paint order (z)', String(surface.z), (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    mutateSelected((target) => {
      target.z = parsed;
    });
  });
  zField.input.type = 'number';
  inspector.append(zField.field);

  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.hidden = true;
  inspector.append(notice);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-block';
  remove.textContent = 'Delete surface';
  remove.addEventListener('click', () => {
    poseSession = null;
    update((draft) => {
      draft.surfaces = draft.surfaces.filter((s) => s.id !== renderedForId);
      draft.selectedId = draft.surfaces[0]?.id ?? null;
      draft.activeCorner = null;
    }, { dirty: true });
  });
  inspector.append(remove);

  return {
    id: id.input,
    label: label.input,
    width,
    height,
    clip: clip.input,
    z: zField.input,
    coords,
    sliders,
    notice,
  };
}

function syncInspector(ui: InspectorControls, surface: EditorSurface, state: EditorState): void {
  setUnlessFocused(ui.id, surface.id);
  setUnlessFocused(ui.label, surface.label);
  setUnlessFocused(ui.width, String(surface.resolution[0]));
  setUnlessFocused(ui.height, String(surface.resolution[1]));
  setUnlessFocused(ui.z, String(surface.z));
  ui.clip.checked = surface.clip;

  ui.coords.replaceChildren();
  surface.corners.forEach(([x, y], index) => {
    const row = document.createElement('div');
    row.className = `coords-row${state.activeCorner === index ? ' is-active' : ''}`;
    const key = document.createElement('span');
    key.className = 'coords-key';
    key.textContent = CORNER_NAMES[index] ?? '';
    const vx = document.createElement('span');
    vx.className = 'coords-val';
    vx.textContent = x.toFixed(4);
    const vy = document.createElement('span');
    vy.className = 'coords-val';
    vy.textContent = y.toFixed(4);
    row.append(key, vx, vy);
    ui.coords.append(row);
  });

  const pose = state.image ? poseOf(surface, state.image) : null;
  for (const axis of ['yaw', 'pitch', 'roll'] as const) {
    const { input, output } = ui.sliders[axis];
    const value = pose ? pose[axis] : 0;
    if (document.activeElement !== input) input.value = value.toFixed(1);
    output.textContent = pose ? `${value.toFixed(1)}°` : '—';
    input.disabled = !pose;
  }

  const check = checkSurface(surface);
  const messages = [...check.messages];

  // Only reachable once someone has typed a resolution, since otherwise it
  // tracks the quad — but that is exactly when it goes unnoticed.
  if (state.image && !surface.autoResolution && aspectDrift(surface, state.image) > 0.02) {
    messages.push(
      'The design resolution is a different shape to the quad, so content will be ' +
        'stretched. "Match quad size" fixes it.',
    );
  }

  ui.notice.hidden = messages.length === 0;
  ui.notice.textContent = messages.join(' ');
}

function renderStatus(state: EditorState): void {
  statusCursor.textContent = state.cursor
    ? `${Math.round(state.cursor.x)}, ${Math.round(state.cursor.y)} px`
    : state.image
      ? `${state.image.width} × ${state.image.height}`
      : '—';

  const surface = selectedSurface();
  if (!surface) {
    statusValidity.textContent = `${state.surfaces.length} surface${state.surfaces.length === 1 ? '' : 's'}`;
    statusValidity.className = 'status-cell';
    return;
  }

  const check = checkSurface(surface);
  statusValidity.textContent = check.ok ? 'convex — renderable' : 'invalid quad';
  statusValidity.className = `status-cell ${check.ok ? 'status-ok' : 'status-bad'}`;
}

function mutateSelected(mutate: (surface: EditorSurface) => void): void {
  update((draft) => {
    const target = draft.surfaces.find((s) => s.id === renderedForId);
    if (target) mutate(target);
  }, { dirty: true });
}

function slider(
  axis: 'yaw' | 'pitch' | 'roll',
  min: number,
  max: number,
): { row: HTMLElement; input: HTMLInputElement; output: HTMLOutputElement } {
  const row = document.createElement('div');
  row.className = 'slider-row';

  const label = document.createElement('label');
  label.textContent = axis;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = '0.5';
  label.htmlFor = input.id = `slider-${axis}`;

  const output = document.createElement('output');

  const applyAngle = () => {
    const state = getState();
    const surface = selectedSurface();
    if (!surface || !state.image) return;

    poseSession ??= poseOf(surface, state.image);
    if (!poseSession) return;

    const next: Pose = { ...poseSession, [axis]: Number(input.value) };
    const corners = cornersAtPose(next, surface, state.image);
    if (!corners) return;

    update((draft) => {
      const target = draft.surfaces.find((s) => s.id === surface.id);
      if (target) target.corners = corners;
    }, { dirty: true });
  };

  input.addEventListener('pointerdown', () => {
    const state = getState();
    const surface = selectedSurface();
    poseSession = surface && state.image ? poseOf(surface, state.image) : null;
  });
  input.addEventListener('input', applyAngle);
  input.addEventListener('change', () => {
    poseSession = null;
  });

  row.append(label, input, output);
  return { row, input, output };
}

function textField(
  labelText: string,
  value: string,
  onCommit: (value: string) => void,
): { field: HTMLElement; input: HTMLInputElement } {
  const field = document.createElement('div');
  field.className = 'field';

  const label = document.createElement('span');
  label.className = 'field-label';
  label.textContent = labelText;

  const input = document.createElement('input');
  input.className = 'input';
  input.value = value;
  input.addEventListener('change', () => onCommit(input.value));
  input.addEventListener('blur', () => onCommit(input.value));

  field.append(label, input);
  return { field, input };
}

function numberInput(value: number, onCommit: (value: number) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'input';
  input.type = 'number';
  input.min = '1';
  input.value = String(value);
  const commit = () => {
    const parsed = Number(input.value);
    if (Number.isFinite(parsed) && parsed > 0) onCommit(Math.round(parsed));
  };
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  return input;
}

function checkbox(
  labelText: string,
  checked: boolean,
  onChange: (value: boolean) => void,
): { wrapper: HTMLElement; input: HTMLInputElement } {
  const wrapper = document.createElement('label');
  wrapper.className = 'check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const text = document.createElement('span');
  text.textContent = labelText;
  wrapper.append(input, text);
  return { wrapper, input };
}

function divider(): HTMLElement {
  const line = document.createElement('div');
  line.className = 'divider';
  return line;
}

function setUnlessFocused(input: HTMLInputElement, value: string): void {
  if (document.activeElement !== input) input.value = value;
}
