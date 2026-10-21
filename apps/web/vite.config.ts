import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    // 사이트(index.html)와 에뮬레이터(emulator.html)가 각자 진입점이다.
    rollupOptions: { input: { index: 'index.html', emulator: 'emulator.html' } },
  },
  test: { include: ['test/**/*.test.ts'] },
});
