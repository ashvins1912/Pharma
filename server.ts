import fs from 'fs';
import path from 'path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'url';
import { env } from './backend/config/env.js';
import backendApp from './backend/server.js';
import { createServer as createViteServer } from 'vite';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // Compatibility entrypoint for the existing combined Render deployment.
  // New local development and API deployments use the independent projects.
  const app = backendApp;
  const { PORT, NODE_ENV } = env;
  const isProduction = NODE_ENV === 'production';
  const server = createServer(app);
  let viteServer;

  if (!isProduction) {
    const frontendPath = path.resolve(__dirname, 'frontend');
    viteServer = await createViteServer({
      root: frontendPath,
      server: {
        middlewareMode: true,
        hmr: { server }
      },
      appType: 'spa'
    });
    app.use(viteServer.middlewares);

    // Serve transformed index.html for SPA routes in dev
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith('/api')) {
        return next();
      }
      try {
        const indexPath = path.resolve(frontendPath, 'index.html');
        let template = fs.readFileSync(indexPath, 'utf-8');
        template = await viteServer.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' }).end(template);
      } catch (e: any) {
        viteServer.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    const distPath = path.resolve(__dirname, 'frontend/dist');
    app.use(express.static(distPath));
    app.get('*', (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  // Global uncaught error handler
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    console.error('Unhandled server error:', err);
    res.status(500).json({ message: err?.message || 'Internal server error' });
  });

  server.on('error', async error => {
    if (viteServer) await viteServer.close();
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Stop the other process or set PORT to an available port.`);
    } else {
      console.error('Pharmacy App server failed to listen:', error);
    }
    process.exit(1);
  });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Pharmacy App server running at http://0.0.0.0:${PORT}`);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async error => {
      if (error) console.error('Pharmacy App server shutdown failed:', error);
      if (viteServer) await viteServer.close();
      process.exitCode = error ? 1 : 0;
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
