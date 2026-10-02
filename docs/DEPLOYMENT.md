# Deployment & Production Readiness Guide

**Target Runtime:** Node.js (v20+) with Vite Full-Stack integration  
**Dev Entry Point:** `server.ts` (executes via `tsx server.ts` on port 3000)  
**Prod Entry Point:** `npm run build`, then `tsx server.ts`

## Render: combined application

The root `render.yaml` deploys the compatibility app as one Render web service.
Create a Blueprint from the repository root and choose the branch to deploy.
Set `CORS_ALLOWED_ORIGINS` to the exact HTTPS Render/custom frontend origin,
for example `https://your-service.onrender.com`; do not include paths or use
`*`. Supply the required MongoDB and Supabase values in the Render dashboard.
Keep demo access disabled in production unless it is intentionally configured.

The Blueprint mounts a persistent disk at `/var/data` for WhatsApp's linked
device credentials. Keep one service instance for this disk-backed process.
After deployment, check `/api/v1/health`, complete the WhatsApp QR pairing in
the admin UI, and send a controlled test message before relying on notifications.

---

## 1. Environment Configuration

The following environment variables configure the multi-tenant platform:

```bash
# Server Runtime
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://ashvinpharma.com

# Database (MongoDB)
MONGO_URI=mongodb+srv://...

# Supabase Auth
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Demo Credentials (Staging / Development only)
DEMO_ADMIN_ENABLED=true
DEMO_ADMIN_EMAIL=admin@ashvinpharma.com
DEMO_ADMIN_PASSWORD=...
DEMO_CUSTOMER_ENABLED=true

# Security Keys
ENCRYPTION_SECRET_KEY=ashvin-platform-symmetric-32b-key!
JWT_SECRET=...
```

---

## 2. API Gateway Routing & Reverse Proxy

All public customer and admin traffic routes through `/api/v1/*`.
- Legacy `/api/*` endpoints forward transparently to the corresponding domain services for seamless backwards compatibility.
- Static assets and frontend SPA routing are served by Express using Vite production bundles.

---

## 3. Production Health Checks
- `GET /api/v1/health`: Returns overall gateway, database, and integration service availability.
- `GET /api/v1/health/tenants`: Validates active tenant count and isolation health.
