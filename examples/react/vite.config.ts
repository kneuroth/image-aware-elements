import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  publicDir: fileURLToPath(new URL('../../fixtures', import.meta.url)),
  server: { port: 5181, strictPort: true },
});
