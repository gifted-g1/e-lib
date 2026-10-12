import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from app://parent/ in production, so asset paths must be relative.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'esnext' },
  server: { port: 5174, strictPort: true },
});
