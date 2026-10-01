# Frontend and backend separation

## Frontend

The Vite app, HTML entrypoint, TypeScript configuration, and CSS tooling are
in `frontend/`. The frontend can be started and built independently:

```bash
cd frontend
npm install
npm run dev
npm run build
```

All frontend network calls use the Axios client in
`frontend/src/api/apiClient.js` or service modules built on that client.
`VITE_API_URL` is a browser-visible API origin and defaults to same-origin
requests; in local development, Vite proxies `/api` to `VITE_DEV_API_PROXY`
(default `http://localhost:8080`, the API Gateway). Supabase URL/anon key and restricted Maps
keys are the only intended browser-visible credentials. Never add backend
secrets to `frontend/.env`.

## Backend

The Express app remains in `backend/` and can run independently as an API:

```bash
cd backend
npm install
npm run dev
```

It listens on port 8090 in development by default and should not be publicly
exposed when deployed separately. Configure
`backend/.env.example` values in a private backend environment. The separate
process does not serve frontend files. CORS accepts the configured
origin allowlist at the API Gateway; the backend also requires
`CORS_ALLOWED_ORIGINS` at startup.

The root `npm run dev` launches the frontend, API Gateway, and backend as
independent processes. Root `npm start` starts only the API Gateway.
`server.ts` remains an
explicit compatibility full-stack runner (`npm run dev:legacy` or
`npm run start:legacy`) for the existing combined deployment; it is not used
by the default separate-project commands. `api/[...path].js` remains a Vercel
adapter for backend routes.

## Separation audit

- Frontend entrypoints are `frontend/index.html` and `frontend/src/main.jsx`.
- Backend application entrypoint is `backend/server.js`; standalone listener
  is `backend/server-entry.js`.
- Frontend has no imports from `backend/`, `services/`, Mongoose, repositories,
  or server filesystem utilities.
- The Gateway and backend do not import service implementation files. The
  Gateway validates the user through a backend-protected identity endpoint,
  signs scoped service credentials, and calls services through HTTP.
- Existing browser routes under `/api/*` remain for behavior compatibility;
  versioned `/api/v1/*` routes are adopted incrementally rather than changing
  every workflow during this project organization phase.

This is structural separation, not a claim that every business capability has
already moved out of the legacy backend or that every API is versioned.
The backend route registry and current layering assessment are documented in
[`backend-routes.md`](./backend-routes.md).
