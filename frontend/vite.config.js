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
    }),
    {
      name: 'mock-api-fallback',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.startsWith('/api')) {
            res.setHeader('Content-Type', 'application/json');
            
            // Handle specific routes
            if (req.url.includes('/auth/me')) {
              res.end(JSON.stringify({
                status: 'success',
                data: {
                  user: {
                    id: 'demo-admin-1',
                    email: 'ashvinsingh25@gmail.com',
                    role: 'admin',
                    app_metadata: { role: 'admin' },
                    permissions: ['*']
                  }
                }
              }));
              return;
            }
            if (req.url.includes('/auth/csrf')) {
              res.end(JSON.stringify({ csrfToken: 'mock-csrf-token' }));
              return;
            }
            if (req.url.includes('/auth/login') || req.url.includes('/auth/google') || req.url.includes('/auth/demo')) {
              res.end(JSON.stringify({
                status: 'success',
                token: 'mock-jwt-token-123',
                user: {
                  id: 'demo-admin-1',
                  email: 'ashvinsingh25@gmail.com',
                  role: 'admin',
                  app_metadata: { role: 'admin' },
                  permissions: ['*']
                }
              }));
              return;
            }
            if (req.url.includes('/medicines')) {
              res.end(JSON.stringify({
                medicines: [
                  { _id: 'med-1', name: 'Paracetamol 500mg', category: 'Pain Relief', price: 25, stock: 150, description: 'Effective fever and pain reducer', prescriptionRequired: false },
                  { _id: 'med-2', name: 'Amoxicillin 250mg', category: 'Antibiotic', price: 120, stock: 80, description: 'Broad-spectrum antibiotic capsule', prescriptionRequired: true },
                  { _id: 'med-3', name: 'Cetirizine 10mg', category: 'Allergy', price: 45, stock: 200, description: 'Anti-allergy antihistamine tablet', prescriptionRequired: false },
                  { _id: 'med-4', name: 'Metformin 500mg', category: 'Diabetes', price: 85, stock: 120, description: 'Blood sugar control medication', prescriptionRequired: true },
                  { _id: 'med-5', name: 'Omeprazole 20mg', category: 'Gastric', price: 95, stock: 90, description: 'Acid reflux and ulcer relief', prescriptionRequired: false }
                ],
                total: 5,
                page: 1,
                totalPages: 1
              }));
              return;
            }
            if (req.url.includes('/medicine-requests') || req.url.includes('/admin/medicine-requests')) {
              res.end(JSON.stringify({
                requests: [
                  { _id: 'req-1', status: 'Pending', customerName: 'John Doe', createdAt: new Date().toISOString(), items: [{ name: 'Amoxicillin 250mg', quantity: 1 }] }
                ],
                total: 1,
                count: 1
              }));
              return;
            }
            if (req.url.includes('/orders')) {
              res.end(JSON.stringify({
                orders: [
                  { _id: 'ord-1', status: 'Delivered', totalAmount: 145, createdAt: new Date().toISOString(), items: [{ name: 'Paracetamol 500mg', quantity: 2, price: 25 }] }
                ],
                total: 1
              }));
              return;
            }
            
            // Generic fallback for any other API call
            res.end(JSON.stringify({ status: 'success', data: {}, message: 'Mock API response' }));
            return;
          }
          next();
        });
      }
    }
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
