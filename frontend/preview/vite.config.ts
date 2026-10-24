import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Bundles the same UI into one self-contained HTML file for a shareable design preview.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../../shared/src', import.meta.url)),
      '@': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
