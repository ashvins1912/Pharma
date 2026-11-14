import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAdminControlPlaneApp } from './server.js';
import { createAdminRbacRouter } from '../../backend/gateway/routes/adminRbac.js';
import {
  createCodeLevelRbacService,
  DEFAULT_CATALOG_PATH,
  DEFAULT_GATEWAY_CAPABILITY_PATH
} from '../../backend/authorization/CodeLevelRbacService.js';
import { issuePharmaAccessToken } from '../../backend/security/pharmaToken.js';

async function requestJson(baseUrl, pathname, { method = 'GET', token = null, body = undefined } = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

test('admin-control-plane enforces Super Admin auth and executes full RBAC Read/Display/Modify/Redeploy/Rollback flow', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-svc-rbac-test-'));
  const catalogPath = path.join(tmpDir, 'AuthorizationCatalogService.js');
  const snapshotDir = path.join(tmpDir, 'snapshots');
  await fs.writeFile(catalogPath, await fs.readFile(DEFAULT_CATALOG_PATH, 'utf8'), 'utf8');

  const rbacService = createCodeLevelRbacService({
    catalogPath,
    gatewayCapabilityPath: DEFAULT_GATEWAY_CAPABILITY_PATH,
    snapshotDir
  });
  const app = createAdminControlPlaneApp({ rbacRouter: createAdminRbacRouter(rbacService) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const customerToken = await issuePharmaAccessToken({
      sub: 'cust-1',
      email: 'cust@example.com',
      role: 'customer',
      roles: ['customer'],
      permissions: ['orders.read']
    });
    const superAdminToken = await issuePharmaAccessToken({
      sub: 'admin-1',
      email: 'root@pharma.local',
      role: 'SUPER_ADMIN',
      roles: ['SUPER_ADMIN'],
      permissions: ['*'],
      scope: 'PLATFORM'
    });

    // 1. Unauthenticated blocked
    const unauth = await requestJson(baseUrl, '/api/v1/admin/rbac/code-catalog');
    assert.equal(unauth.status, 401);

    // 2. Customer blocked
    const forbidden = await requestJson(baseUrl, '/api/v1/admin/rbac/code-catalog', { token: customerToken });
    assert.equal(forbidden.status, 403);

    // 3. Super Admin Read
    const readRes = await requestJson(baseUrl, '/api/v1/admin/rbac/code-catalog', { token: superAdminToken });
    assert.equal(readRes.status, 200);
    assert.equal(readRes.json.success, true);
    assert.ok(readRes.json.data.catalog.rolePermissions.TENANT_OWNER);

    // 4. Super Admin Preview Diff
    const nextCatalog = structuredClone(readRes.json.data.catalog);
    nextCatalog.features.push('audit_reports');
    nextCatalog.permissions.push(['audit_reports', 'read']);
    nextCatalog.rolePermissions.TENANT_OWNER.push('audit_reports.read');

    const previewRes = await requestJson(baseUrl, '/api/v1/admin/rbac/preview-diff', {
      method: 'POST',
      token: superAdminToken,
      body: { catalog: nextCatalog }
    });
    assert.equal(previewRes.status, 200);
    assert.equal(previewRes.json.data.valid, true);
    assert.ok(previewRes.json.data.diff.addedFeatures.includes('audit_reports'));

    // 5. Super Admin Modify
    const modifyRes = await requestJson(baseUrl, '/api/v1/admin/rbac/code-catalog', {
      method: 'PUT',
      token: superAdminToken,
      body: {
        catalog: nextCatalog,
        changeReference: 'CHG-ADMIN-SVC-42',
        confirmation: 'APPLY CODE RBAC CHANGE',
        syncDatabase: false
      }
    });
    assert.equal(modifyRes.status, 200);
    assert.ok(modifyRes.json.data.snapshotId);

    // 6. Super Admin Redeploy
    const redeployRes = await requestJson(baseUrl, '/api/v1/admin/rbac/redeploy', {
      method: 'POST',
      token: superAdminToken,
      body: {
        changeReference: 'CHG-ADMIN-SVC-42',
        confirmation: 'CONFIRM REDEPLOY',
        environment: 'staging',
        bumpAllSessions: false
      }
    });
    assert.equal(redeployRes.status, 200);
    assert.equal(redeployRes.json.data.success, true);
    assert.ok(redeployRes.json.data.artifactDigest);

    // 7. History & Rollback
    const historyRes = await requestJson(baseUrl, '/api/v1/admin/rbac/history', { token: superAdminToken });
    assert.equal(historyRes.status, 200);
    assert.ok(historyRes.json.data.snapshots.some(s => s.snapshotId === modifyRes.json.data.snapshotId));

    const rollbackRes = await requestJson(baseUrl, '/api/v1/admin/rbac/rollback', {
      method: 'POST',
      token: superAdminToken,
      body: {
        snapshotId: modifyRes.json.data.snapshotId,
        confirmation: 'ROLLBACK CODE RBAC'
      }
    });
    assert.equal(rollbackRes.status, 200);
    assert.equal(rollbackRes.json.data.catalog.features.includes('audit_reports'), false);

    // 8. Centralized Governance Roles & Sensitive Activity Logs (Admin vs Staff vs Customer)
    const staffToken = await issuePharmaAccessToken({
      sub: 'staff-1',
      email: 'staff@example.com',
      role: 'PHARMACY_STAFF',
      roles: ['PHARMACY_STAFF'],
      tenantId: 'tenant-1',
      permissions: ['orders.read', 'orders.manage']
    });

    const custGovRes = await requestJson(baseUrl, '/api/v1/admin/rbac/governance/roles', { token: customerToken });
    assert.equal(custGovRes.status, 403);

    const staffModifyRes = await requestJson(baseUrl, '/api/v1/admin/rbac/governance/users/cust-1/role', {
      method: 'PATCH',
      token: staffToken,
      body: { role: 'Admin', reason: 'Attempt escalation' }
    });
    assert.equal(staffModifyRes.status, 403);

    const adminRolesRes = await requestJson(baseUrl, '/api/v1/admin/rbac/governance/roles', { token: superAdminToken });
    assert.equal(adminRolesRes.status, 200);
    assert.deepEqual(
      adminRolesRes.json.data.canonicalTiers.map(t => t.tier),
      ['Admin', 'Staff', 'Customer']
    );

    const adminLogsRes = await requestJson(baseUrl, '/api/v1/admin/rbac/governance/activity-logs', { token: superAdminToken });
    assert.equal(adminLogsRes.status, 200);
    assert.ok(Array.isArray(adminLogsRes.json.data.logs));
    assert.ok(adminLogsRes.json.data.logs.some(entry => entry.outcome === 'DENIED' && entry.actorId === 'staff-1'));
    assert.ok(adminLogsRes.json.data.logs.some(entry => entry.action === 'CODE_RBAC_MODIFIED' && entry.outcome === 'ALLOWED'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
