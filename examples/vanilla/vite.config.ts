import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The fixtures live at the repo root so every example and the E2E suite render
// byte-identical scenes. Serving them as the public dir avoids duplicating the
// image and manifest into each app.
export default defineConfig({
  publicDir: fileURLToPath(new URL('../../fixtures', import.meta.url)),
  server: { port: 5180, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
