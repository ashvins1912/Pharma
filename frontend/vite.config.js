import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federation from '@originjs/vite-plugin-federation';

// https://vite.dev/config/
export default defineConfig({
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
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_PROXY || 'http://localhost:8080',
        changeOrigin: true
      }
    }
  },
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false
  }
});
