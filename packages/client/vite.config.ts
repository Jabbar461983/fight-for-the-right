import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative Pfade, damit der Build auch unter https://<name>.github.io/<repo>/ läuft.
  base: './',
  resolve: {
    alias: {
      '@data': fileURLToPath(new URL('../../data', import.meta.url)),
    },
  },
  server: {
    // host: true → auch im WLAN erreichbar (zum Testen auf Tablet/Handy).
    host: true,
    port: 5173,
    fs: { allow: ['../..'] },
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});
