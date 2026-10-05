import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const core = fileURLToPath(new URL('../../packages/core/src', import.meta.url));
// El servidor de la API en desarrollo; la web le habla por /v1 sin salir de su origen.
const api = { '/v1': { target: process.env.ATALAYA_API ?? 'http://localhost:8787', changeOrigin: true } };

// base relativa: el resultado funciona servido desde cualquier ruta.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@core': core } },
  server: { proxy: api, fs: { allow: ['../..'] } },
  preview: { proxy: api },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/app[extname]',
      },
    },
  },
});
