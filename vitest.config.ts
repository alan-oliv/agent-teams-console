import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    css: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // FS-watcher tests depend on macOS FSEvents delivery, which drops events when many
    // vitest workers compete for them. Production covers this with the 5s reconciliation
    // sweep, but these tests exercise raw watchers which have no fallback.
    fileParallelism: false,
  },
});
