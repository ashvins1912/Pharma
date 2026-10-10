/**
 * Legacy authentication route removed.
 * Canonical authentication lives under /api/v1/auth and is mounted by gatewayRouter.
 * This module remains as an import-safe compatibility shim for unused legacy routers.
 */
import express from 'express';
import { generateCsrfToken, setSessionCookies } from '../security/sessionCookie.js';
import localDemoAuthRoutes from './localDemoAuthRoutes.js';

const router = express.Router();

router.get('/csrf', (req, res) => {
  const token = generateCsrfToken();
  setSessionCookies(res, { csrfToken: token });
  return res.json({ csrfToken: token });
});

router.use(localDemoAuthRoutes);

router.use((req, res) => res.status(410).json({
  success: false,
  code: 'LEGACY_AUTH_ROUTE_REMOVED',
  message: 'Use /api/v1/auth for authentication.'
}));

export default router;
