import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build can be served from any sub-path.
  base: './',
  server: {
    port: 8080,
  },
  build: {
    // Phaser alone is ~1.2 MB minified; raise the limit so it doesn't warn on every build.
    chunkSizeWarningLimit: 1600,
  },
});
