# Local development

## Independent applications

1. Install dependencies in each application:

   ```bash
   npm --prefix backend install
   npm --prefix api-gateway install
   npm --prefix frontend install
   ```

2. Environment files are optional for local startup. The backend uses an
   in-memory datastore when `MONGO_URI` is unset, and the Gateway and frontend
   have local defaults. To customize them, copy `backend/.env.example` to
   `backend/.env` and `frontend/.env.example` to `frontend/.env`. Keep secrets
   out of `frontend/.env`; only browser-safe `VITE_*` values belong there.
3. Start each application in a separate terminal from the repository root:

   ```bash
   npm --prefix backend run dev
   npm --prefix api-gateway run dev
   npm --prefix frontend run dev
   ```

Open `http://localhost:3000`. The frontend proxies `/api` to the Gateway at
`http://localhost:8080`; the Gateway forwards requests to the backend at
`http://localhost:8090`. Keep all three processes running. If a port is already
in use, stop the other process using it before restarting the application.

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

The root `npm run dev` and `npm start` commands run the legacy combined
frontend/backend server, not the separate Gateway/frontend/backend processes
above. Use that runner on its own; do not start it alongside the standalone
frontend because both use port `3000` by default. For the independent
applications, use the three commands in separate terminals.

Run checks for an individual application from the repository root with
`npm --prefix frontend run build`, `npm --prefix frontend run lint`, or
`npm --prefix api-gateway test` / `npm --prefix backend test`.
