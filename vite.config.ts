import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = 'http://127.0.0.1:4823';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': SERVER, '/stream': SERVER, '/hook': SERVER },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
