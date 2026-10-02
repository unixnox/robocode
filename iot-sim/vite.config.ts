import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1600 },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
