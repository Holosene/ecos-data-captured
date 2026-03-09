import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { publishSessionPlugin } from './vite-plugin-publish.js';
import path from 'path';

let commitHash = 'unknown';
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch { /* not in git repo */ }

export default defineConfig({
  plugins: [react(), publishSessionPlugin()],
  base: '/ecos-data-captured/',
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  resolve: {
    alias: {
      '@echos/core': path.resolve(__dirname, '../../packages/core/src'),
      '@echos/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@echos/ui/styles.css': path.resolve(__dirname, '../../packages/ui/src/styles.css'),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
});
