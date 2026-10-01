# Local development

## Independent applications

1. Install dependencies in each project:

   ```bash
   npm --prefix backend install
   npm --prefix api-gateway install
   npm --prefix frontend install
   ```

2. Configure `backend/.env` from `backend/.env.example` and browser-safe
   values in `frontend/.env` from `frontend/.env.example`.
3. Start both projects from the repository root:

   ```bash
   npm run dev
   ```

The frontend is served at `http://localhost:3000` and proxies `/api` to the
Gateway at `http://localhost:8080`; the Gateway forwards to the backend at
`http://localhost:8090`.

In staging/production set `CORS_ALLOWED_ORIGINS` on the Gateway to every exact
frontend origin that should use credentialed browser requests. Production
requires HTTPS origins; do not use `*`. Backend production startup also
requires the setting although the Gateway strips browser `Origin` before
forwarding. When running separate origins, set `VITE_API_URL` to the public
Gateway origin. Do not configure the browser to call Inventory or Order
service origins directly.

## Extracted services

Inventory and Order Services are separate packages under `services/`, each
with its own package manifest, `.env.example`, Dockerfile/Render deployment
settings as applicable, tests, and README. Run each from its own directory.
They require their own database/configuration; do not point either service at
the legacy application's `MONGO_URI`.

## Compatibility runner

Root `npm run dev` starts the separate frontend, Gateway, and backend processes.
`npm start` runs the API Gateway; `npm run start:backend` runs the backend
directly. `npm run dev:legacy` and
`npm run start:legacy` explicitly invoke the combined `server.ts` runner. The
current Render blueprint uses the legacy command until the frontend deployment
is separated. Root `npm run build` and `npm run lint` delegate to the frontend.
