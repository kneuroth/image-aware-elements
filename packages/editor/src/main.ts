import {
  downloadManifest,
  imageFromFile,
  loadManifestFrom,
  loadSession,
  measureImage,
  saveToDisk,
  surfacesFromManifest,
} from './io.js';
import { renderPanels } from './panels.js';
import { renderPreview } from './preview.js';
import { initStage, renderStage, zoomBy, zoomToFit } from './stage.js';
import {
  createSurface,
  getState,
  subscribe,
  update,
  framingFromRaw,
  variantsFromRaw,
  type EditorImage,
} from './state.js';

const fileReadout = document.querySelector<HTMLElement>('#file-readout')!;
const dropzone = document.querySelector<HTMLElement>('#dropzone')!;
const saveButton = document.querySelector<HTMLButtonElement>('#save')!;
const modeMark = document.querySelector<HTMLButtonElement>('#mode-mark')!;
const modeScreens = document.querySelector<HTMLButtonElement>('#mode-screens')!;
const addButton = document.querySelector<HTMLButtonElement>('#add-surface')!;
const zoomReadout = document.querySelector<HTMLElement>('#zoom-readout')!;

function render(): void {
  const state = getState();

  dropzone.hidden = state.image !== null;
  addButton.disabled = state.image === null;
  saveButton.disabled = state.image === null;
  modeMark.disabled = state.image === null;
  modeScreens.disabled = state.image === null;
  modeMark.setAttribute('aria-pressed', String(state.mode === 'mark'));
  modeScreens.setAttribute('aria-pressed', String(state.mode === 'preview'));
  saveButton.textContent = state.canWriteToDisk ? 'Save JSON' : 'Download JSON';
  zoomReadout.textContent = `${Math.round(state.zoom * 100)}%`;

  fileReadout.textContent = state.image
    ? `${state.image.src} · ${state.image.width}×${state.image.height}${state.dirty ? ' · unsaved' : ''}`
    : 'no image loaded';

  renderStage(state);
  renderPanels(state);
  renderPreview(state);
}

async function adoptImage(image: EditorImage, manifestUrl?: string): Promise<void> {
  const loaded = manifestUrl ? await loadManifestFrom(manifestUrl) : null;
  const surfaces = loaded ? surfacesFromManifest(loaded.manifest, image) : [];
  const variants = loaded ? variantsFromRaw(loaded.raw) : [];

  update((draft) => {
    draft.image = image;
    draft.surfaces = surfaces;
    draft.variants = variants;
    draft.base = framingFromRaw(loaded?.raw as Record<string, unknown> | null);
    draft.selectedId = surfaces[0]?.id ?? null;
    draft.activeCorner = null;
    draft.dirty = false;
  });

  zoomToFit();
}

function wireControls(): void {
  addButton.addEventListener('click', () => {
    const state = getState();
    if (!state.image) return;
    const surface = createSurface(state.image, state.surfaces);
    update((draft) => {
      draft.surfaces.push(surface);
      draft.selectedId = surface.id;
      draft.activeCorner = null;
    }, { dirty: true });
  });

  const setMode = (mode: 'mark' | 'preview') => () =>
    update((draft) => {
      draft.mode = mode;
      draft.loupeAt = null;
    });
  modeMark.addEventListener('click', setMode('mark'));
  modeScreens.addEventListener('click', setMode('preview'));

  saveButton.addEventListener('click', async () => {
    const state = getState();
    if (!state.image) return;

    if (!state.canWriteToDisk) {
      downloadManifest(state);
      update((draft) => {
        draft.dirty = false;
      });
      return;
    }

    saveButton.disabled = true;
    try {
      await saveToDisk(state);
      update((draft) => {
        draft.dirty = false;
      });
    } catch (error) {
      // Surfaced in the header rather than an alert, so it does not interrupt a
      // marking session.
      fileReadout.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      saveButton.disabled = false;
    }
  });

  document.querySelector('#zoom-in')!.addEventListener('click', () => zoomBy(1.25));
  document.querySelector('#zoom-out')!.addEventListener('click', () => zoomBy(0.8));
  document.querySelector('#zoom-fit')!.addEventListener('click', () => zoomToFit());

  // Drag and drop, for the static mode.
  for (const type of ['dragenter', 'dragover'] as const) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-hot');
    });
  }
  for (const type of ['dragleave', 'dragend'] as const) {
    dropzone.addEventListener(type, () => dropzone.classList.remove('is-hot'));
  }
  dropzone.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-hot');
    const file = event.dataTransfer?.files?.[0];
    if (file?.type.startsWith('image/')) await adoptImage(await imageFromFile(file));
  });

  window.addEventListener('resize', () => render());

  window.addEventListener('beforeunload', (event) => {
    if (getState().dirty) event.preventDefault();
  });

  // Ctrl/Cmd+S saves in either mode.
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveButton.click();
    }
  });
}

async function start(): Promise<void> {
  subscribe(render);
  initStage();
  wireControls();

  const session = await loadSession();
  if (session) {
    update((draft) => {
      draft.canWriteToDisk = true;
    });
    const { width, height } = await measureImage(session.imageUrl);
    await adoptImage(
      { url: session.imageUrl, src: session.imageSrc, width, height },
      session.hasManifest ? './api/manifest' : undefined,
    );
    return;
  }

  // Static mode. In dev the repo fixtures are served, so open on a real scene
  // rather than an empty dropzone.
  if (import.meta.env.DEV) {
    try {
      const { width, height } = await measureImage('./desk.svg');
      await adoptImage({ url: './desk.svg', src: 'desk.svg', width, height }, './desk.surfaces.json');
      return;
    } catch {
      // Fixtures are not being served; fall through to the dropzone.
    }
  }

  render();
}

void start();
