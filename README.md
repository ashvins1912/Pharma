# Pharma
Pharma online store

## Deploying to Render

The `render.yaml` blueprint builds the Vite frontend before starting the Express
server and sets `NODE_ENV=production`. The server listens on Render's assigned
`PORT` (or port 3000 when running locally).

To persist data between deployments, configure `MONGO_URI` with a reachable
MongoDB connection string. For MongoDB Atlas, allow the Render service's
outbound IP addresses in the Atlas network access list. Without a reachable
MongoDB database, the app logs a warning and uses in-memory data, which is not
persistent.
