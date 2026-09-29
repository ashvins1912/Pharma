# Pharma
Pharma online store

## Deploying to Render

The `render.yaml` blueprint builds the Vite frontend before starting the Express
server and sets `NODE_ENV=production`. The server listens on Render's assigned
`PORT` (or port 3000 when running locally).

If deploying an existing Render service without using the blueprint, set its
Root Directory to the repository root, Build Command to
`npm install && npm run build`, and Start Command to `npm start`. The `npm start` lifecycle also builds
the frontend before launching the server, so the `dist` directory exists.

To persist data between deployments, configure `MONGO_URI` with a reachable
MongoDB connection string. For MongoDB Atlas, allow the Render service's
outbound IP addresses in the Atlas network access list. Without a reachable
MongoDB database, the app logs a warning and uses in-memory data, which is not
persistent.

## Google sign-in

Google sign-in requires a Supabase project; demo access works without one. Set
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the local `.env` file and
in the Render service's **Environment** settings, then redeploy. For a new
service created from `render.yaml`, Render prompts for these `sync: false`
values. For an existing Render service, add both variables manually. These
`VITE_` values are embedded into the frontend during the build, so changing
them requires a redeploy.

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

## Google Maps address suggestions

Set `VITE_GOOGLE_MAPS_API_KEY` in `.env` and in the Render service environment,
then rebuild/redeploy. Enable billing and the **Maps JavaScript API** and
**Places API** for that key in Google Cloud. Restrict the key to your deployed
website and local development origins using HTTP referrer restrictions, and
restrict its API access to those Maps APIs. Address suggestions autofill the
street, area, city, state, postal code, and map coordinates; manual entry
remains available if the key or service is unavailable.
