import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: fileURLToPath(new URL('../../fixtures', import.meta.url)),
  server: { port: 5199, strictPort: true },
});
