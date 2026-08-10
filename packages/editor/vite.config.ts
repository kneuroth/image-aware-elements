import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: './',
  // Serve the repo fixtures during `pnpm dev` so the editor opens on a real
  // scene instead of an empty dropzone — but keep them out of the published
  // bundle, where they would be dead weight.
  publicDir: command === 'serve' ? fileURLToPath(new URL('../../fixtures', import.meta.url)) : false,
  server: { port: 5190, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
}));
