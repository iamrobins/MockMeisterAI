import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: '../public',
  build: { outDir: '../dist/client', emptyOutDir: true },
});
