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

            if (req.url.includes('/tenants/nearby')) {
              res.end(JSON.stringify({
                status: 'success',
                tenants: [
                  {
                    _id: '65a1234567890abcdef12345',
                    shopName: 'City Health Pharmacy & Wellness',
                    address: { street: '123 Main Street', city: 'San Francisco', state: 'CA', zipCode: '94105' },
                    geoLocation: { type: 'Point', coordinates: [-122.4194, 37.7749] },
                    shopPhotoUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80',
                    distanceKm: 1.2
                  },
                  {
                    _id: '65b234567890abcdef67890',
                    shopName: 'MetroCare Express Pharmacy',
                    address: { street: '456 Market Street', city: 'San Francisco', state: 'CA', zipCode: '94104' },
                    geoLocation: { type: 'Point', coordinates: [-122.4000, 37.7800] },
                    shopPhotoUrl: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=500&q=80',
                    distanceKm: 2.5
                  }
                ]
              }));
              return;
            }

            if (req.url.includes('/tenant/branches')) {
              res.end(JSON.stringify({
                status: 'success',
                branches: [
                  { id: 'branch-1', name: 'Downtown Flagship Dispensary', status: 'ACTIVE', location: '123 Main Street, San Francisco, CA', serviceRadiusKm: 12, minimumOrderValue: 150 },
                  { id: 'branch-2', name: 'Northside Express Hub', status: 'ACTIVE', location: '456 Health Ave, San Francisco, CA', serviceRadiusKm: 15, minimumOrderValue: 200 },
                  { id: 'branch-3', name: 'Westend Wellness Depot', status: 'MAINTENANCE', location: '789 Care Blvd, San Francisco, CA', serviceRadiusKm: 10, minimumOrderValue: 100 }
                ],
                pagination: { page: 1, limit: 10, total: 3, totalPages: 1 }
              }));
              return;
            }

            if (req.url.includes('/vendor/profile')) {
              res.end(JSON.stringify({
                status: 'success',
                tenant: {
                  _id: '65a1234567890abcdef12345',
                  shopName: 'City Health Pharmacy & Wellness',
                  address: {
                    street: '123 Main Street',
                    city: 'San Francisco',
                    state: 'CA',
                    zipCode: '94105'
                  },
                  geoLocation: {
                    type: 'Point',
                    coordinates: [-122.4194, 37.7749]
                  },
                  shopPhotoUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80',
                  ownerDetails: {
                    name: 'Ashvin Singh',
                    email: 'ashvinsingh25@gmail.com',
                    phone: '+19876543210'
                  }
                },
                personnel: [
                  { _id: 'user-1', name: 'Ashvin Singh', email: 'ashvinsingh25@gmail.com', role: 'OWNER' },
                  { _id: 'user-2', name: 'Jane Doe', email: 'jane.admin@pharmacy.com', role: 'TENANT_ADMIN' },
                  { _id: 'user-3', name: 'Bob Smith', email: 'bob.manager@pharmacy.com', role: 'MANAGER' }
                ]
              }));
              return;
            }

            if (req.url.includes('/admin/tenants/')) {
              res.end(JSON.stringify({
                status: 'success',
                data: {
                  branches: [
                    {
                      id: 'branch-1',
                      name: 'Downtown Flagship Dispensary',
                      address: { street: '123 Main Street', city: 'San Francisco', pincode: '94105' },
                      serviceRadiusKm: 12,
                      minimumOrderValue: 150
                    },
                    {
                      id: 'branch-2',
                      name: 'Northside Express Hub',
                      address: { street: '456 Health Ave', city: 'San Francisco', pincode: '94108' },
                      serviceRadiusKm: 15,
                      minimumOrderValue: 200
                    }
                  ],
                  memberships: [
                    { id: 'm-1', email: 'owner@pharmacy.com', role: 'TENANT_ADMIN', status: 'ACTIVE' },
                    { id: 'm-2', email: 'manager@pharmacy.com', role: 'MANAGER', status: 'ACTIVE' }
                  ]
                }
              }));
              return;
            }

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

            if (req.url.includes('/medicines')) {
              res.end(JSON.stringify({
                medicines: [
                  { _id: 'med-1', name: 'Paracetamol 500mg', category: 'Pain Relief', price: 25, stock: 150, description: 'Effective fever and pain reducer', prescriptionRequired: false }
                ],
                total: 1,
                page: 1,
                totalPages: 1
              }));
              return;
            }

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
