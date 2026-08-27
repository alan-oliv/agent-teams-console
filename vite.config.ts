import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4823',
      '/stream': 'http://127.0.0.1:4823',
    },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
