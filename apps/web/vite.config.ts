import mdx from '@mdx-js/rollup';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [{ enforce: 'pre', ...mdx() }, react(), tailwindcss()],
  worker: { format: 'es' },
  build: {
    // 사이트(index.html)·챕터(chapter.html)·에뮬레이터(emulator.html)가 각자 진입점이다.
    rollupOptions: {
      input: { index: 'index.html', chapter: 'chapter.html', emulator: 'emulator.html' },
    },
  },
  test: { include: ['test/**/*.test.ts'] },
});
