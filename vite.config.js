import { defineConfig } from 'vite';

export default defineConfig({
  // Root configuration to run and build index.html directly from root folder
  root: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000
  }
});
