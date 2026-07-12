import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ command }) => {
  return {
    plugins: [react(), tailwindcss()],
    ...(command === 'build' ? {
      plugins: [react(), tailwindcss(), {
        name: 'strip-iwer-emulator-dynamic-import',
        transform(code: string, id: string) {
          if (id.includes('@pmndrs/xr') && id.endsWith('/store.js')) {
            return code.replace("const { emulate } = await import('./emulate.js');", "const { emulate } = { emulate: () => null };");
          }
          return null;
        },
      }],
    } : {}),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        ...(command === 'build' ? {
          '@iwer/devui': path.resolve(__dirname, 'src/shims/empty.ts'),
          '@iwer/sem': path.resolve(__dirname, 'src/shims/empty.ts'),
          'iwer': path.resolve(__dirname, 'src/shims/empty.ts'),
          '@pmndrs/xr/dist/emulate.js': path.resolve(__dirname, 'src/shims/empty.ts'),
        } : {}),
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
            three: ['three'],
            r3f: ['@react-three/fiber', '@react-three/drei', '@react-three/xr'],
            maps: ['@react-google-maps/api'],
            animation: ['motion'],
            icons: ['lucide-react'],
          },
        },
      },
    },
  };
});
