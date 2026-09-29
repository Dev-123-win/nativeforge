import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      motionflow: path.resolve(__dirname, 'src/core/index.ts'),
    },
  },
  server: {
    port: 3100,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        composition: path.resolve(__dirname, 'composition.html'),
        forgeScene: path.resolve(__dirname, 'forge-scene.html'),
      },
    },
  },
});
