# Frontend build and deployment

## Runtime

The frontend is a Vite + React application. Its entry point is
`src/main.jsx`; application-wide providers live in `src/app/AppProviders.jsx`.
The provider order is explicit and should only be changed when the consuming
contexts are updated together.

## Local development

From the repository root:

```sh
npm install --include=dev
npm run dev:frontend
```

The Vite development server listens on port 3000 and proxies `/api/*` to
`VITE_DEV_API_PROXY`, defaulting to `http://localhost:8080`.

## Production build

From the repository root:

```sh
npm install --include=dev
npm run build
```

The build output is `frontend/dist`.

This repository currently has no npm lockfile. Do not use `npm ci` until a
root workspace lockfile has been generated and committed. npm ci requires a
lockfile and a synchronized package manifest.

## Render static site

- Root directory: repository root
- Build command: `npm install --include=dev --no-audit --no-fund && npm run build`
- Publish directory: `frontend/dist`

Keep the `/api/*` rewrites ahead of the SPA catch-all rewrite. Production
frontend API requests intentionally use same-origin relative paths so
HttpOnly session cookies remain first-party.
