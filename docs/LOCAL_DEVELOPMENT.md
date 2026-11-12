# Local development workspace

The repository root is the single entry point for the frontend and independently deployed services.

## Quick start

1. Install Node.js (20.19+ recommended), Python 3.10+, and Redis. MongoDB and the required external credentials must also be available for the services that use them.
2. Copy each `.env.example` to `.env` in the same folder. Start with `env/common/.env.example`, then configure the relevant service/UI file. Local service values override common values; values already exported in the shell take precedence.
3. Run `npm run all` from the repository root. This installs npm and Python dependencies, builds the frontend, performs Python syntax checks, and starts the services plus UI.
4. Open http://localhost:3000. Press Ctrl+C to stop the stack.

## Individual commands

- `npm run setup:all` — install root npm workspace dependencies and create/install isolated Python virtual environments for the prescription and shared-cache services.
- `npm run build:all` — run the frontend's existing production build and Python syntax checks.
- `npm run start:all` (or `npm run dev`) — start all local processes without reinstalling/building.
- `npm run all` — setup, build, then start.

## Environment layout

- `env/common/.env`: shared non-UI settings and defaults.
- `frontend/env/.env`: Vite public configuration (only `VITE_*` values; never secrets).
- `api-gateway/env/.env`, `backend/env/.env`: API process configuration.
- `services/<service>/env/.env`: independently configurable service settings.

The orchestrator reads common settings first, then service-specific settings, then the invoking shell environment (highest priority). Environment files are local-only and ignored by Git. Only the example templates are committed.

## Local dependencies and safety

- MongoDB is required by the backend, inventory, medicine-master, and order services.
- Redis is required by the shared-cache service. The cache service listens on port 8081 locally to avoid the gateway's port 8080.
- Configure valid local JWT/public-key and internal service secrets before using authenticated cross-service flows. Do not copy production secrets into committed files.
- The frontend receives only Vite-prefixed public values. Server-only credentials must remain in backend/service environment files.
- The Python prescription and cache services use isolated `.venv` directories; these are not committed.
- The cache-services directory contains cache client/deployment support files; the runnable FastAPI server is services/caching-service.
