import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import federation from '@originjs/vite-plugin-federation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// One Vite configuration is used for local development and Render builds.
// API requests stay on /api so local Vite proxying and the production Render
// rewrite exercise the same frontend request paths.
export default defineConfig(({ mode }) => ({
  // Read the repository-level shared env file for UI builds and local dev.
  envDir: '..',
  base: '/',
  plugins: [
    react(),
    federation({
      name: 'host_app',
      filename: 'remoteEntry.js',
      exposes: {
        './useGlobalStore': './src/store/useGlobalStore.js',
        './api': './src/services/api.js'
      },
      shared: ['react', 'react-dom', 'zustand', 'axios']
    })
  ],
  resolve: {
    alias: {
      '@pharma/algorithm-kernel': path.resolve(__dirname, '../packages/algorithm-kernel/src/index.js')
    },
    extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json']
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_PROXY || 'http://localhost:8080',
        changeOrigin: true,
        secure: mode !== 'development'
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'axios', '@supabase/supabase-js', 'zustand']
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The federation plugin emits top-level await in shared dependency chunks.
    // es2020 rejects it during esbuild's final transpilation.
    target: 'esnext',
    minify: 'esbuild',
    cssCodeSplit: true,
    assetsInlineLimit: 4096,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1500
  }
}));
