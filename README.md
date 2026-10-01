# Pharma
Pharma online store

## Frontend and backend projects

The browser app now lives in `frontend/`; backend API code and its independent
Node server live in `backend/`. The public API Gateway lives in `api-gateway/`,
and extracted services live under `services/`.
Frontend modules communicate with HTTP endpoints through the shared Axios
client in `frontend/src/api/apiClient.js`; no frontend module imports backend
source, Mongoose, or server-side credentials.

For independent local development, run `npm run dev` from the repository
root. It starts the frontend at `http://localhost:3000`, the public API
Gateway at `http://localhost:8080`, and the backend privately at
`http://localhost:8090`; Vite proxies `/api` requests to the Gateway. Install
dependencies with `npm --prefix backend install`,
`npm --prefix api-gateway install`, and `npm --prefix frontend install`.

Set browser-safe `VITE_API_URL` to the public API origin in production when
frontend and API have different origins. Never put MongoDB URIs, service JWT
secrets, Supabase service-role keys, or other server secrets in the frontend
environment. See each project’s `.env.example`.

Configure Gateway CORS with `CORS_ALLOWED_ORIGINS`, a comma-separated list of
exact browser origins (scheme + host + optional port, no path or trailing
slash). Development defaults to localhost ports 3000 and 5173. Production
requires this variable and HTTPS origins; it never falls back to a wildcard.
The backend also requires it at startup, but the Gateway is responsible for
browser CORS. Requests without an `Origin` remain allowed for health checks
and server-to-server clients.

Root `npm start` runs the API Gateway; run `npm run start:backend` only when
starting the private backend directly. `npm run build` and `npm run lint`
delegate to the frontend. The root Render blueprint explicitly uses
`npm run start:legacy` to retain the current combined deployment through
`server.ts`; `npm run dev:legacy` is available for that combined local mode.
Vercel's `api/[...path].js` continues to expose the Express API.

## Deploying the frontend to Vercel

Vercel hosts the Vite frontend and the Express API through the catch-all
function in `api/[...path].js`. Copy the values from
`.env.vercel.example` into **Project Settings → Environment Variables** for
each deployment environment, replacing every placeholder. Set
`VITE_API_URL` to an empty value to send API requests to the same Vercel
deployment's compatibility API. To route versioned requests through the
standalone Gateway and its service authentication, set `VITE_API_URL` to the
public Gateway origin instead. Set server-side `MONGO_URI`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in Vercel; do not add
private backend secrets as `VITE_` variables or expose them to the frontend.
If using a separately hosted Express backend instead, set `VITE_API_URL` to
that backend's origin.

`VITE_` values are embedded when Vite builds the site, so redeploy after
changing them. Set the deployed Vercel URL as `VITE_FRONTEND_URL` and add that
origin to Supabase's allowed redirect URLs. Vercel Speed Insights is mounted
in the app entry point; enable Speed Insights for the Vercel project to view
collected metrics.

## Deploying to Render

The `render.yaml` blueprint builds the Vite frontend before starting the Express
server and sets `NODE_ENV=production`. The server listens on Render's assigned
`PORT` (or port 5000 by default).

If deploying an existing Render service without using the blueprint, set its
Root Directory to the repository root, Build Command to
`npm install && npm run build`, and Start Command to `npm start`. The `npm start` lifecycle also builds
the frontend before launching the server, so `frontend/dist` exists.

For a separately deployed API-only backend, use `backend/render.yaml` or set
the Render Root Directory to `backend`, Build Command to `npm install`, and
Start Command to `npm start`. Configure the backend environment from
`backend/.env.example`, including `CORS_ALLOWED_ORIGINS` for production startup
validation. This backend deployment does not build or serve the frontend.
Deploy the Gateway separately with `api-gateway/render.yaml` and configure
`BACKEND_API_URL` to the backend's private origin. The existing root Render
blueprint still uses the combined compatibility runner; it is not the separate
Gateway deployment.

The separate Inventory Service deployment is defined in
`services/inventory-service/render.yaml`. Configure its dedicated replica-set
MongoDB URI and server-only `SERVICE_AUTH_SECRET`. Set
`INVENTORY_SERVICE_URL` and the same service secret on the standalone API
Gateway. Set `GATEWAY_AUTH_SECRET` on both Gateway and backend for the
Gateway's authenticated user-identity verification call. Create development
data directly in its owning service; no production migration or dual-write
process is required.

The server validates its required environment variables before starting.
Configure `MONGO_URI` with a reachable MongoDB connection string, such as
`mongodb://localhost:27017/pharma` for a local database or the
`mongodb+srv://...` connection string provided by Atlas. Do not leave the
example value or Atlas placeholders in the URI,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the
Render service's Environment settings. `SUPABASE_ANON_KEY` is used by the
backend authentication client; the public `VITE_SUPABASE_ANON_KEY` configures
the browser client. The blueprint declares these as `sync: false`, so Render
prompts for them when creating a new service; existing services must add them
manually. A local `.env` file is not deployed to Render. For MongoDB Atlas,
allow the Render service's outbound IP addresses in the Atlas network access
list. The server exits at startup if a required variable is missing or invalid.

## Google sign-in

Google sign-in requires a Supabase project; demo access works without one. Set
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the local `.env` file and
in the Render service's **Environment** settings, then redeploy. Also set
`SUPABASE_URL` to the same project URL so the server can validate signed-in
users' tokens on protected API routes. For a new
service created from `render.yaml`, Render prompts for these `sync: false`
values. For an existing Render service, add all five Supabase variables
manually. The `VITE_` values are embedded into the frontend during the build,
so changing them requires a redeploy.

The frontend and backend Supabase clients are configured separately: use
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the browser, and
`SUPABASE_URL` and `SUPABASE_ANON_KEY` for backend email/password auth. The
service-role key is only used for privileged server operations and must never
be exposed through a `VITE_` variable.

In Supabase, enable Google under **Authentication → Providers → Google** and
configure its OAuth client credentials. Add
`https://<your-project-ref>.supabase.co/auth/v1/callback` as an authorized
redirect URI in Google Cloud. In **Authentication → URL Configuration**, set
the site URL to the deployed app origin and add both the deployed origin and
`http://localhost:3000` to the redirect URL allow list.

For email/password accounts, enable **Confirm email** under **Authentication →
Providers → Email** in Supabase. The app sends the Supabase confirmation link
during sign-up, rejects unverified sign-ins, and supports password reset links
that return to the app origin. Make sure the deployed origin is in Supabase's
allowed redirect URLs and configure SMTP under **Project Settings → Auth →
SMTP Settings** for reliable production email delivery.

## Local demo administrator

The demo administrator is disabled by default. To enable the demo buttons in
Render, explicitly set `DEMO_ADMIN_ENABLED=true`,
`DEMO_ADMIN_USER_ID=admin`, `DEMO_ADMIN_EMAIL=ashvinsingh25@gmail.com`, and
`DEMO_ADMIN_JWT_SECRET` to a private random secret of at least 32 characters
(for example, generate one with `openssl rand -hex 32`). Enable the passwordless
admin demo button only for a trusted demo deployment by setting
`DEMO_ADMIN_INSTANT_ACCESS_ENABLED=true` and
`VITE_INSTANT_DEMO_ACCESS_ENABLED=true`. The button grants full administrator
access, so do not enable it on a public production service. Keep
`VITE_DEMO_ADMIN_ENABLED=true` to show the local admin login hint. The backend
issues a one-hour signed token and validates it on every protected request.

Demo customer access is also opt-in for production. Set
`DEMO_CUSTOMER_ENABLED=true`, `DEMO_CUSTOMER_JWT_SECRET` to a separate private
random secret of at least 32 characters, and `VITE_INSTANT_DEMO_ACCESS_ENABLED=true`
plus `VITE_DEMO_CUSTOMER_ENABLED=true` to show the sign-in button. Set `DEMO_CUSTOMER_MOBILE` to a WhatsApp-capable
number if demo orders should receive customer notifications. These demo
credentials are test-only and should not contain real customer data.

The Render blueprint prompts for these `sync: false` demo variables when
creating a service; existing services must add them manually. Changes to
`VITE_INSTANT_DEMO_ACCESS_ENABLED` require a redeploy because Vite embeds it
during the build.

## Rider fleet lifecycle

The fallback in-memory rider repository starts empty; riders must be onboarded
by an administrator. Suspending or removing a rider disables the existing
record and stores the admin's remark instead of deleting it. Disabled riders
are excluded from the active fleet and assignment engine, but administrators
can view and re-enable them. Onboarding a disabled rider with the same mobile
number reactivates that record and preserves its delivery history.

## Bulk inventory imports

Administrator inventory workbooks are stored privately in MongoDB GridFS and
processed by persistent background import jobs. The importer stages source
rows in batches, uses unordered bulk upserts, and records row-level failures
without rolling back successful inventory updates. Admins can poll job
progress and download an Excel report containing only failed rows and their
original input columns.

The importer defaults to 250 rows per batch, three concurrent batches per
import, one concurrent import job, and a 100 MiB workbook upload limit.
Configure these limits with `INVENTORY_IMPORT_BATCH_SIZE` (maximum 1,000),
`INVENTORY_IMPORT_CONCURRENCY` (maximum 5),
`INVENTORY_IMPORT_JOB_CONCURRENCY` (maximum 3), and
`INVENTORY_IMPORT_MAX_FILE_BYTES`. Set these values according to the MongoDB
deployment's available memory and connection pool. Import job and row
progress is persisted in MongoDB, so queued imports can resume after a server
restart.

## Inventory Service boundary

`services/inventory-service/` contains a separately deployable Inventory Service with
its own MongoDB database, scoped service JWT authentication, inventory
reservation/release/deduction APIs, stock adjustment, and asynchronous Excel
import jobs. When configured, the standalone API Gateway authenticates the
user, enforces admin-only adjustment/import permissions, and signs a short-lived
scoped service JWT for `/api/v1/inventory`. The backend no longer proxies or
signs requests for this service.

Legacy catalog, checkout, Medicine Request, and admin UI workflows still use
the existing backend datastore; the extracted service does not yet replace all
of those paths. This is a code restructuring, not a production data migration:
initialize development data directly in the Inventory Service database. See
`services/inventory-service/README.md` for deployment settings, route scopes,
transaction requirements, and known import memory limits. Do not configure the
Inventory Service with the main app's `MONGO_URI`.

## Order Service boundary

`services/order-service/` is a separately deployable Order Service with its own MongoDB
database, scoped service JWTs, versioned Order API, idempotent creation,
immutable snapshots, lifecycle transitions, and an event outbox. It reads
product/price snapshots and reserves/releases/deducts stock through the
Inventory Service API; it never connects to the Inventory database or the main
application's MongoDB.

The API Gateway validates users through the backend and issues scoped
service-to-service credentials before routing `/api/v1/orders` to this service
when `ORDER_SERVICE_URL` is configured. If unset, the existing backend
versioned route continues to run. Create Order and Inventory development data
directly in their owning services; production data migration and dual writes
are not required. The extracted service does not yet replace legacy checkout,
Medicine Request conversion, rider assignment, or WhatsApp notification
consumption. See `services/order-service/README.md` for service contracts and
deployment settings.

## Versioned Order API and lifecycle events

The additive `/api/v1/orders` contract is intended to be consumed by authorized
clients without exposing MongoDB document fields. It accepts a product SKU or
catalog reference plus quantity, and returns a public `orderId`, source,
external reference, lifecycle status, totals, delivery data, and immutable item
snapshots. `POST` requires `Idempotency-Key` or `externalReference`; replaying
the same source/reference and item set returns the existing Order, while
reusing it for different items conflicts. Sources include `WEB`, `MOBILE`,
`ADMIN`, `POS`, `ERP`, `PARTNER`, and `API`. Admins can filter paginated
`GET /api/v1/orders` results by source, customer, status, and date range;
individual orders are retrieved by public `orderId`.

When `ORDER_SERVICE_URL` is configured, the API Gateway validates the user
through the backend's private identity endpoint and routes the versioned
contract to the Order Service using a scoped short-lived service JWT. It reads
catalog metadata/pricing and coordinates stock reservation, release, and
deduction through Inventory. Partner API-key/OAuth credentials,
per-client rate limits, webhooks, and asynchronous exports are not yet
implemented. Do not treat the client-provided `source` as an authentication
identity.

Order creation and core inventory reservation now write business events to a
MongoDB outbox in the same database transaction. Lifecycle and rider
assignment routes also emit events; an outbox worker retries notification
delivery with bounded exponential backoff and preserves the existing WhatsApp
messages for placement, ready-for-dispatch, assignment, dispatch, and delivery.
Assignment still uses the existing automatic rider engine and retains manual
assignment when no rider is available. The outbox is an in-process consumer
boundary, not yet a broker or independent Notification Service; status writers
still need to be consolidated on the service-owned event contract.

## Promoting a Supabase administrator

After the intended account has signed in to this Supabase project at least once,
set `SUPABASE_SERVICE_ROLE_KEY` in the local, git-ignored `.env` file using the
project's server-side service-role/secret key. Never use a `VITE_` variable or
share this key. Run `npm run admin:promote` to grant `app_metadata.role=admin`
to `ashvinsingh25@gmail.com`, or pass another existing account email as an
argument. The script searches Supabase Auth and updates the trusted
`app_metadata` field without changing user metadata or passwords. Sign out and
back in afterward so the account receives a fresh token.

## Google Maps address suggestions

Set `VITE_GOOGLE_MAPS_API_KEY` in `.env` and in the Render service environment,
then rebuild/redeploy. Enable billing and the **Maps JavaScript API** and
**Places API** for that key in Google Cloud. Restrict the key to your deployed
website and local development origins using HTTP referrer restrictions, and
restrict its API access to those Maps APIs. Address suggestions autofill the
street, area, city, state, postal code, and map coordinates; manual entry
remains available if the key or service is unavailable.
