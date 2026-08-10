import { parseManifest } from '@image-aware/core';
import { fromManifest, toManifest, type EditorImage, type EditorSurface } from './state.js';

export interface Session {
  /** URL to load the photo from. */
  readonly imageUrl: string;
  /** Path recorded in the manifest. */
  readonly imageSrc: string;
  /** Where the manifest would be written. */
  readonly manifestPath: string;
  /** Whether an existing manifest was found. */
  readonly hasManifest: boolean;
}

/**
 * Ask the CLI whether it is serving a file to edit in place.
 *
 * A 404 means the editor is running as a static page, so it falls back to
 * drag-and-drop plus a download. Same bundle, two delivery modes.
 */
export async function loadSession(): Promise<Session | null> {
  try {
    const response = await fetch('./api/session');
    if (!response.ok) return null;
    return (await response.json()) as Session;
  } catch {
    return null;
  }
}

export interface LoadedManifest {
  readonly manifest: ReturnType<typeof parseManifest>;
  /**
   * The untouched JSON. Variants must be read from this rather than the parsed
   * manifest, which resolves inheritance and appends a fallback — saving those
   * back would bake inherited values into the file.
   */
  readonly raw: unknown;
}

export async function loadManifestFrom(url: string): Promise<LoadedManifest | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    return { manifest: parseManifest(raw), raw };
  } catch {
    return null;
  }
}

/** Read an image's intrinsic size by decoding it. */
export function measureImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error(`Could not load image: ${url}`));
    image.src = url;
  });
}

export async function imageFromFile(file: File): Promise<EditorImage> {
  const url = URL.createObjectURL(file);
  const { width, height } = await measureImage(url);
  return { url, src: file.name, width, height };
}

export function surfacesFromManifest(
  manifest: ReturnType<typeof parseManifest>,
  image: EditorImage,
): EditorSurface[] {
  return fromManifest(manifest, image);
}

/**
 * Serialise a manifest for a human to read and for git to diff.
 *
 * Plain `JSON.stringify(_, null, 2)` explodes every coordinate pair across six
 * lines, which makes the file tedious to scan and turns a one-corner nudge into a
 * large diff. Collapsing innermost numeric arrays onto one line keeps corners
 * readable as points.
 */
export function formatManifest(manifest: unknown): string {
  return JSON.stringify(manifest, null, 2).replace(
    /\[\s*(-?\d[\d.eE+-]*(?:\s*,\s*-?\d[\d.eE+-]*)*)\s*\]/g,
    (_match, inner: string) => `[${inner.split(/\s*,\s*/).join(', ')}]`,
  );
}

/** Write the manifest back to disk through the CLI. */
export async function saveToDisk(state: Parameters<typeof toManifest>[0]): Promise<void> {
  const manifest = toManifest(state);
  if (!manifest) throw new Error('Nothing to save yet.');

  const response = await fetch('./api/manifest', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: formatManifest(manifest),
  });

  if (!response.ok) {
    throw new Error(`Save failed (${response.status}): ${await response.text()}`);
  }
}

/** Download the manifest as a file, for the static/no-server mode. */
export function downloadManifest(state: Parameters<typeof toManifest>[0]): void {
  const manifest = toManifest(state);
  if (!manifest) return;

  const stem = manifest.image.src.replace(/\.[^./\\]+$/, '') || 'image';
  const blob = new Blob([formatManifest(manifest)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${stem}.surfaces.json`;
  link.click();
  URL.revokeObjectURL(url);
}
