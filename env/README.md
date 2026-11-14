# Shared local environment

All local workspaces (frontend/UI, API gateway, backend, Node microservices,
Python services, workers and the shell host) receive configuration from one
repository-level environment file.

## First-time setup

1. Copy `env/common/.env.example` to `env/local.env`.
2. Edit `env/local.env` once with your local MongoDB, Redis and optional provider
   settings.
3. Run `npm run dev` to start the local workspace, or `npm run start:all` for
   the build + complete local startup flow.

`env/local.env` is private and ignored by Git. Do not commit credentials,
private keys, service tokens or production connection strings.

## Resolution rules

- Existing process/shell/CI variables take precedence and are never overwritten.
- The legacy root `.env` is loaded for backward compatibility.
- `env/local.env` is the canonical shared local file and fills values not
  already supplied by the shell or legacy file.
- Service-specific settings remain supported as overrides; do not duplicate
  common values into each workspace's own `.env`.
- Vite reads the same root-level process environment, so `VITE_*` values are
  shared with the UI. Only browser-safe values may use the `VITE_` prefix.
- Production deployments continue to receive environment values from their
  deployment platform; local files are not required or loaded into production
  images by deployment configuration.

The loader intentionally does not generate or persist secrets. The local
workspace may generate ephemeral JWT keys at startup when no keys are supplied.
