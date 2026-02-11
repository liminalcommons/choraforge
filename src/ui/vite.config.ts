/**
 * ABOUTME: Vite configuration for the ChoraForge web UI.
 * Builds the React SPA to dist/ui for serving by the remote server.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/ui',
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:18080',
        ws: true,
      },
      '/screenshots': {
        target: 'http://localhost:18080',
      },
    },
  },
});
