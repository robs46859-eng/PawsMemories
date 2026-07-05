import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      // Force all R3F ecosystem packages (@react-three/fiber, drei, xr) to
      // share a single copy of three.js. Without this, Vite may bundle
      // multiple copies, triggering "Multiple instances of Three.js" which
      // breaks GLTFLoader, materials, and AR rendering.
      dedupe: ['three'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            maps: ['@react-google-maps/api'],
            animation: ['motion'],
            icons: ['lucide-react'],
          },
        },
      },
    },
  };
});
