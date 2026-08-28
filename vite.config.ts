import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = 'http://127.0.0.1:4823';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  server: {
    port: 5173,
    // Anchor with a trailing slash: a bare '/api' prefix also matches the
    // module request for src/web/api.ts, which vite would then proxy to the
    // backend (404) — breaking the whole module graph and rendering nothing.
    proxy: { '^/api/': SERVER, '/stream': SERVER, '/hook': SERVER },
  },
  build: { outDir: '../../plugin/dist/web', emptyOutDir: true },
});
