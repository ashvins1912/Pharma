# Pharma
Pharma online store

## Deploying to Render

The `render.yaml` blueprint builds the Vite frontend before starting the Express
server and sets `NODE_ENV=production`. The server listens on Render's assigned
`PORT` (or port 5000 by default).

If deploying an existing Render service without using the blueprint, set its
Root Directory to the repository root, Build Command to
`npm install && npm run build`, and Start Command to `npm start`. The `npm start` lifecycle also builds
the frontend before launching the server, so the `dist` directory exists.

The server validates its required environment variables before starting.
Configure `MONGO_URI` with a reachable MongoDB connection string,
`SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` in the Render service's
Environment settings. The blueprint declares these as `sync: false`, so Render
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
values. For an existing Render service, add all three Supabase variables
manually. The `VITE_` values are embedded into the frontend during the build,
so changing them requires a redeploy.

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

The demo administrator is disabled by default and cannot authenticate when
`NODE_ENV=production`. For local development only, set `DEMO_ADMIN_ENABLED=true`,
`DEMO_ADMIN_USER_ID=admin`, `DEMO_ADMIN_EMAIL=ashvinsingh25@gmail.com`, and
`DEMO_ADMIN_PASSWORD` in `.env`. Set `DEMO_ADMIN_JWT_SECRET` to a private random
secret of at least 32 characters (for example, generate one with
`openssl rand -hex 32`) and set `VITE_DEMO_ADMIN_ENABLED=true` plus
`VITE_DEMO_ADMIN_EMAIL=ashvinsingh25@gmail.com` for the Vite frontend. Use the
regular email/password sign-in form. The example password `admin` may be used
for an isolated local demo only; never use it on a network-accessible or
production deployment. The backend issues a one-hour signed token and validates
it on every protected request; the demo account is not seeded into production
MongoDB or accepted as a production credential.

To show the login screen's **Instant Demo Access** buttons in local development,
also set `DEMO_ADMIN_INSTANT_ACCESS_ENABLED=true` and
`VITE_INSTANT_DEMO_ACCESS_ENABLED=true`. The latter controls whether the buttons
are rendered; the backend flag separately guards the passwordless admin-token
endpoint. Set both to `false` (or remove them) to disable instant access. This
passwordless shortcut is unavailable in production.

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
