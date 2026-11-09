# Pharma production security baseline

## What this change enforces in code

- The public API Gateway and backend attach HSTS in production, MIME sniffing protection, clickjacking protection, a restrictive referrer policy, a browser permissions policy and a minimal document policy.
- The static frontend deployment descriptor adds the same browser-facing headers. Geolocation and camera remain available to the first-party app; microphone access is disabled.
- Session access cookies now explicitly use `SameSite=Lax` alongside `HttpOnly` and production `Secure`. The refresh cookie and CSRF cookie already use `SameSite=Lax`.
- Production backend startup now requires a dedicated `ENCRYPTION_SECRET_KEY` of at least 32 characters. The crypto helper no longer silently falls back to a public/default or demo-admin signing secret in production.
- The prescription service independently requires `PRESCRIPTION_ENCRYPTION_KEY` and `SERVICE_AUTH_SECRET` in production and encrypts prescription payloads with AES-GCM.

## Deployment steps (required)

1. Confirm the existing Render API service has a high-entropy `ENCRYPTION_SECRET_KEY` configured (at least 32 characters; use a password manager/secret generator). The deployment descriptor marks it as a secret.
2. **Do not rotate or replace the currently deployed value during this rollout.** Existing AES-GCM encrypted MFA fields were created with the key active at write time. Replacing it without a verified re-encryption migration can make those records unreadable and disable affected MFA accounts. Back up the value in an approved secrets manager before any planned rotation.
3. Configure `PRESCRIPTION_ENCRYPTION_KEY` separately for the prescription service. Keep it stable; never reuse the backend encryption key, JWT signing key, gateway secret or service-auth secret.
4. Ensure every public hostname is served through Render's managed TLS certificate and redirects HTTP to HTTPS. HSTS is emitted by the application; the hosting edge remains responsible for certificate issuance, renewal and HTTP-to-HTTPS redirection.
5. Ensure the backend, database and internal services are not directly exposed to the public internet. The browser should call the frontend same-origin `/api/*` rewrite through the Gateway.
6. Confirm MongoDB Atlas TLS is required, encryption at rest is enabled, network access is restricted to required services, and automated encrypted backups/PITR are enabled. Application-level field encryption is not a substitute for database encryption or backups.
7. Rotate any credentials suspected of exposure, revoke active sessions, and review audit logs. Do not paste secrets into GitHub issues, PR comments, chat, build logs or source control.

## Security boundaries and remaining work

- HTTPS/HSTS protects data in transit between browsers and the public edge. It does not stop XSS, malicious browser extensions, compromised devices, credential theft or server-side authorization bugs.
- Backend `cryptoVault` is used for explicitly encrypted fields (currently MFA secrets); it does **not** transparently encrypt every customer, order, address or tenant field. Prescription documents have a separate AES-GCM encryption pipeline. Verify MongoDB Atlas encryption-at-rest and storage ACLs for all other data.
- The current auth limiter uses process-local memory. It is not a distributed rate limiter and can be bypassed across multiple instances; production should use a shared Redis-backed limiter at the Gateway for login, signup, password reset, MFA and OTP endpoints.
- A strict full-site CSP requires an inventory of every script, image, font, map, OAuth and WebSocket origin. This PR applies a minimal document policy and clickjacking defense without breaking the current CDN/OAuth integrations. A nonce/hash-based CSP with report-only rollout remains recommended.
- Dependency/SCA scanning, secret scanning, WAF/bot protection, security monitoring, incident response, key rotation with re-encryption, and an independent penetration test remain operational controls. No application can be guaranteed breach-proof.

## Verification checklist

- Run backend and API Gateway test suites, frontend production build and type-check.
- Inspect deployed response headers on the frontend and Gateway over HTTPS.
- Test login, refresh rotation, logout, Google sign-in, CSRF rejection, cross-origin rejection, upload validation and tenant-boundary authorization.
- Confirm prescription download URLs are short-lived and require authorized access.
- Verify backups can be restored and encrypted records can be decrypted using the preserved production keys.
