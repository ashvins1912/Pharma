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
