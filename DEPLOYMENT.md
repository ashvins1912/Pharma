# Pharma — Deployment & Operations Runbook

> Canonical deployment source of truth. Application architecture belongs in AI_CONTEXT.md.
> Repository: ashvins1912/Pharma | Branch: main | Verified: 2026-10-07

## 1. Topology
~~~text
Internet
  -> Frontend
  -> API Gateway
       -> private Backend platform API
       -> private Inventory Service
       -> private Order Service
       -> private Prescription API
                              <-> Prescription Worker
~~~

Current Render manifests:
- api-gateway/render.yaml — public Node web service
- services/inventory-service/render.yaml — private Node service + persistent disk
- services/order-service/render.yaml — private Node service
- services/prescription-service/render.yaml — Python API + Python worker

There is no current root Render blueprint for the complete platform. Do not recreate the old combined/root deployment unless explicitly requested.

## 2. Known environment URLs
~~~text
Frontend:    https://pharma-ui.onrender.com
API Gateway: https://pharma-api-gateway.onrender.com
~~~
Treat these as deployment values, not source-code constants. Verify live availability before claiming a service is healthy.

## 3. API Gateway Render
File: api-gateway/render.yaml

~~~text
runtime: node
rootDir: api-gateway
buildCommand: npm install
startCommand: npm start
healthCheckPath: /ready
proxy timeout: 120000 ms
auth timeout: 15000 ms
~~~

Required/configured environment:
~~~text
BACKEND_API_URL=http://ashvin-pharmacy-platform:10000
GATEWAY_AUTH_SECRET
SERVICE_AUTH_SECRET
INVENTORY_SERVICE_URL
ORDER_SERVICE_URL
PRESCRIPTION_SERVICE_URL
CORS_ALLOWED_ORIGINS
SERVICE_JWT_ISSUER=ashvin-pharmacy
SERVICE_JWT_AUDIENCE=inventory-service
ORDER_SERVICE_JWT_AUDIENCE=order-service
PRESCRIPTION_SERVICE_JWT_AUDIENCE=prescription-service
~~~

## 4. Inventory Render
File: services/inventory-service/render.yaml

~~~text
runtime: node
type: private service
rootDir: services/inventory-service
healthCheckPath: /ready
database: pharma_inventory
disk: /var/data (2 GB)
batch size: 250
worker concurrency: 1
max retries: 3
max file size: 104857600 bytes
~~~

Required:
~~~text
INVENTORY_MONGO_URI
SERVICE_AUTH_SECRET
~~~
The Render disk is for import/work files, not the authoritative inventory database.

## 5. Order Render
File: services/order-service/render.yaml

~~~text
runtime: node
type: private service
rootDir: services/order-service
healthCheckPath: /ready
database: pharma_orders
prescription reconciliation interval: 10000 ms
reconciliation batch size: 20
~~~

Required:
~~~text
ORDER_MONGO_URI
SERVICE_AUTH_SECRET
INVENTORY_SERVICE_URL
PRESCRIPTION_SERVICE_URL
~~~

## 6. Prescription API + worker
File: services/prescription-service/render.yaml

Two processes are required.

API:
~~~text
runtime: python
rootDir: services/prescription-service
build: pip install -r requirements.txt
start: uvicorn main:app --host 0.0.0.0 --port \${PORT:-10000}
health: /health
~~~

Worker:
~~~text
runtime: python
rootDir: services/prescription-service
build: pip install -r requirements.txt
start: python -m app.workers
~~~

Shared configuration:
~~~text
MONGO_URI
PRESCRIPTION_DB_NAME=pharma_prescriptions
PRESCRIPTION_ENCRYPTION_KEY
SERVICE_AUTH_SECRET
SERVICE_JWT_ISSUER=ashvin-pharmacy
SERVICE_JWT_AUDIENCE=prescription-service
PRESCRIPTION_MAX_RETRIES=3
~~~

Worker:
~~~text
WORKER_ID
PROCESSING_LEASE_SECONDS=600
HEARTBEAT_INTERVAL_SECONDS=45
~~~

Never expose the worker publicly.

## 7. Backend platform API
Backend is the private platform/orchestration boundary.

Typical local configuration:
~~~text
PORT=8090
MONGO_URI=mongodb://localhost:27017/pharma
PRESCRIPTION_SERVICE_URL=http://localhost:8000
SERVICE_AUTH_SECRET=<secret>
~~~

There is no current standalone backend Render manifest in the repository. If backend production deployment is required, deploy it as a private service rather than restoring the old root combined application.

## 8. Frontend
Directory: frontend/

Build:
~~~bash
cd frontend
npm install
npm run build
~~~

Environment:
~~~text
VITE_API_URL=/api
VITE_DEV_API_PROXY=http://localhost:8080
VITE_FRONTEND_URL=http://localhost:3000
VITE_SUPABASE_URL=<Google OAuth broker URL>
VITE_SUPABASE_ANON_KEY=<browser-safe Supabase key>
~~~

Do not put private keys, service secrets or Supabase service-role keys in frontend variables.

## 9. Pharma JWT production keys
Backend application sessions use RS256.

Required:
~~~text
PHARMA_JWT_PRIVATE_KEY
PHARMA_JWT_PUBLIC_KEY
PHARMA_JWT_ISSUER=pharma-auth
PHARMA_JWT_AUDIENCE=pharma-api
PHARMA_ACCESS_TOKEN_TTL=1h
~~~

The **same RSA key pair** must be configured on both services:
- Backend: `PHARMA_JWT_PRIVATE_KEY` + `PHARMA_JWT_PUBLIC_KEY`
- API Gateway: `PHARMA_JWT_PUBLIC_KEY` only

The Backend signs Pharma access/refresh JWTs with the private key. The Gateway verifies access JWTs with the matching public key. **Never configure the private key on the Gateway or frontend.** If the Gateway public key is missing, protected APIs must not be considered operational.


Generate:
~~~bash
openssl genrsa -out pharma-private.pem 3072
openssl rsa -in pharma-private.pem -pubout -out pharma-public.pem
~~~
Store PEM values only as server-side secrets. Never commit them.
Production intentionally fails when required signing keys are absent. Development can create an ephemeral key pair.

## 10. Secrets that never reach the frontend
Never expose:
- MongoDB credentials
- SERVICE_AUTH_SECRET
- GATEWAY_AUTH_SECRET
- Pharma private signing key
- prescription encryption key
- SMTP passwords
- Supabase service-role key
- third-party API secrets

## 11. CORS
CORS is controlled at the public Gateway.

Production example:
~~~text
CORS_ALLOWED_ORIGINS=https://pharma-ui.onrender.com
~~~
For a custom domain, use that exact origin.

Never use *.
Do not include paths in allowed origins. Preflight OPTIONS must work.


## 11A. Browser authentication security contract
The browser talks to the API Gateway through the frontend's same-origin `/api/*` rewrite. The Gateway is therefore the browser trust boundary.

Anonymous startup:
~~~text
GET /api/v1/auth/me -> 401 (expected anonymous state; no refresh is triggered)
GET /api/medicines?page=1&limit=16 -> 200
~~~

Authenticated startup:
~~~text
POST /api/v1/auth/login -> HttpOnly access/refresh cookies + XSRF-TOKEN
GET /api/v1/auth/me -> 200
protected APIs -> Gateway JWT verification -> RBAC -> trusted backend credential -> backend
~~~

Session recovery:
~~~text
protected request -> 401
one refresh request -> rotated HttpOnly session cookies
original request retried once with the fresh cookie
~~~

State-changing browser requests are protected at the Gateway with exact-origin/Fetch-Metadata checks and a double-submit `XSRF-TOKEN` header. The backend retains its own CSRF middleware for direct/internal compatibility. Production session cookies use `Secure; HttpOnly; SameSite=Lax; Path=/`. Refresh sessions are persisted server-side, rotated on every refresh, revoked on logout, and replacement lifetime is bounded by the original refresh session expiry. Legacy refresh tokens are bootstrapped on first use and then rotated.

Do not reintroduce automatic CSRF bootstrap, automatic retries for catalog failures, or browser access to the private backend. The expected anonymous `/auth/me` 401 is not an outage.

## 12. Health checks
~~~text
Gateway       /ready
Inventory     /ready
Order         /ready
Prescription  /health
~~~

For the current Render topology, `ashvin-pharmacy-platform` is a private service. The Gateway must reach it over Render's private network; do not point `BACKEND_API_URL` at the frontend or an obsolete public API hostname.

After deployment verify:
1. process is running
2. health endpoint passes
3. DB connection works
4. service authentication works
5. Gateway can route to the private service

A green Render process alone is not a production smoke test.

## 13. Deployment sequence
1. Validate main.
2. Deploy/verify Inventory.
3. Deploy/verify Order.
4. Deploy/verify Prescription API.
5. Deploy/verify Prescription Worker.
6. Deploy/verify private Backend if changed.
7. Deploy/verify Gateway and private target URLs.
8. Deploy frontend with correct API origin.
9. Run public Gateway smoke tests.
10. Verify authentication, authorization, tenant isolation and critical business flows.

When a service contract changes, deploy a compatible provider before switching the Gateway to it.

## 14. Required smoke tests

### Authentication
- Email login creates Pharma HttpOnly session.
- Google exchange creates Pharma session.
- Direct Supabase JWT is rejected by application APIs.
- Expired/invalid Pharma token returns 401.
- Missing session returns 401.

### Authorization
- Allowed permission succeeds.
- Missing permission returns 403.
- Cross-tenant access is denied.
- Wrong branch context is denied.
- Internal calls require valid service credentials.

### Inventory
- Availability
- reserve
- release
- deduct
- import job creation
- partial import failure
- retry/failure download

### Prescription
- upload
- durable job
- worker claim
- OCR/NLP processing
- lease heartbeat
- review/approve/reject
- private document access
- lease-loss protection

### Order
- idempotent creation
- authoritative inventory reservation
- prescription gate remains blocked until MATCHED
- DB reconciliation works without browser polling
- cancellation/rejection races are safe

## 15. Local ports
~~~text
Frontend             3000
API Gateway           8080
Backend               8090
Inventory             5100
Order                 5200
Prescription API      8000
~~~

Typical commands:
~~~bash
cd frontend && npm install && npm run dev
cd api-gateway && npm install && npm run dev
cd backend && npm install && npm run dev
cd services/inventory-service && npm install && npm run dev
cd services/order-service && npm install && npm run dev
cd services/prescription-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
python -m app.workers
~~~

Run only services required by the feature.

## 16. Test/build commands
~~~bash
cd frontend && npm run lint && npm run build
cd api-gateway && npm test
cd backend && npm test
cd services/inventory-service && npm test
cd services/order-service && npm test
cd services/prescription-service && python -m pytest
~~~
Only report a command as passed if actually executed.

## 17. Troubleshooting

### Gateway 503
Check target URL, private service health, service networking, SERVICE_AUTH_SECRET and JWT issuer/audience.

### 401
Check Pharma cookie, RS256 keys, issuer/audience, expiry and service credentials.

### 403
Check role, permission name, tenant membership, branch context, permission version and Gateway scope mapping.

### CORS
Check exact frontend origin, CORS_ALLOWED_ORIGINS, preflight response and duplicate proxy headers.

### Prescription jobs stuck
Check worker process, Mongo connectivity, lease timestamps, PROCESSING_LEASE_SECONDS, HEARTBEAT_INTERVAL_SECONDS, retry/dead-letter state and worker logs.

### Inventory import failure
Check /var/data capacity, Mongo connectivity, batch/concurrency values and failed-record job state.

## 18. Rollback
Rollback the smallest affected component.

- Frontend-only issue -> frontend rollback.
- Gateway-only issue -> Gateway rollback.
- Service contract issue -> coordinate compatible provider + Gateway versions.
- Prescription API/worker contract issue -> coordinate API + worker rollback.

Never use production data deletion as rollback.

## 19. Security release checklist
- [ ] RS256 production keys configured
- [ ] No secrets committed
- [ ] Supabase service-role key is server-only
- [ ] Exact CORS origins configured
- [ ] Internal services private
- [ ] Prescription worker private
- [ ] HttpOnly session cookies enabled
- [ ] Service authentication enabled
- [ ] Tenant/branch authorization verified
- [ ] Health checks passing
- [ ] Sensitive logging disabled
- [ ] Prescription documents private
- [ ] Encryption key configured and securely backed up

## 20. Release principle
~~~text
main
 -> build/test
 -> private services healthy
 -> Gateway routing verified
 -> frontend configured
 -> authentication verified
 -> authorization + tenant isolation verified
 -> critical business smoke tests
 -> production release
~~~

Do not call a deployment production-ready merely because Render says the process is running.
