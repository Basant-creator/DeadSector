import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build can be served from any sub-path.
  base: './',
  server: {
    // Vite's default. 8080 clashed with Steam's embedded browser, which listens there while
    // Steam runs; without strictPort, Vite moves to the next free port if this one is taken.
    port: 5173,
  },
  build: {
    // Phaser alone is ~1.2 MB minified; raise the limit so it doesn't warn on every build.
    chunkSizeWarningLimit: 1600,
  },
});
