import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/renderer/src/test/setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      'VIDAA/src/**/*.test.{ts,tsx}'
    ],
    coverage: {
      reporter: ['text', 'html']
    }
  }
});
