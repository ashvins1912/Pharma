import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  createCodeLevelRbacService,
  DEFAULT_CATALOG_PATH,
  DEFAULT_GATEWAY_CAPABILITY_PATH,
  validateCatalogPayload
} from './CodeLevelRbacService.js';

async function createIsolatedRbacFixture() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rbac-code-test-'));
  const catalogPath = path.join(tmpDir, 'AuthorizationCatalogService.js');
  const snapshotDir = path.join(tmpDir, 'snapshots');
  const originalSource = await fs.readFile(DEFAULT_CATALOG_PATH, 'utf8');
  await fs.writeFile(catalogPath, originalSource, 'utf8');
  const service = createCodeLevelRbacService({
    catalogPath,
    gatewayCapabilityPath: DEFAULT_GATEWAY_CAPABILITY_PATH,
    snapshotDir
  });
  return { tmpDir, catalogPath, snapshotDir, service };
}

test('readCodeRbacState reads live declarative RBAC source and gateway route bindings', async () => {
  const { tmpDir, service } = await createIsolatedRbacFixture();
  try {
    const state = await service.readCodeRbacState();
    assert.ok(state.catalog.features.includes('orders'));
    assert.ok(state.catalog.rolePermissions.SUPER_ADMIN.includes('*'));
    assert.ok(state.lineRange.startLine > 0 && state.lineRange.endLine > state.lineRange.startLine);
    assert.ok(state.policySource.includes('ROLE_PERMISSIONS'));
    assert.ok(state.routeBindings.some(r => r.permission === 'users.manage' && r.pattern.includes('admin')));
    assert.ok(state.policyDigest && state.policyDigest.length === 64);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('validateCatalogPayload rejects super admin lockout and unknown permissions', () => {
  const bad = validateCatalogPayload({
    features: ['orders'],
    permissions: [['orders', 'read']],
    rolePermissions: { SUPER_ADMIN: ['orders.read'], PLATFORM_SUPER_ADMIN: ['*'], admin: ['*'] },
    roleScope: { SUPER_ADMIN: 'PLATFORM', PLATFORM_SUPER_ADMIN: 'PLATFORM', admin: 'PLATFORM' }
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some(msg => msg.includes('SUPER_ADMIN')));

  const unknownPerm = validateCatalogPayload({
    features: ['orders'],
    permissions: [['orders', 'read']],
    rolePermissions: {
      SUPER_ADMIN: ['*'],
      PLATFORM_SUPER_ADMIN: ['*'],
      admin: ['*'],
      CUSTOMER: ['orders.nonexistent']
    },
    roleScope: { SUPER_ADMIN: 'PLATFORM', PLATFORM_SUPER_ADMIN: 'PLATFORM', admin: 'PLATFORM', CUSTOMER: 'CUSTOMER' }
  });
  assert.equal(unknownPerm.valid, false);
  assert.ok(unknownPerm.errors.some(msg => msg.includes('unknown permission')));
});

test('modify, preview diff, redeploy (including deploy hook), and rollback lifecycle works end-to-end', async () => {
  const { tmpDir, catalogPath, service } = await createIsolatedRbacFixture();
  let hookReceivedBody = null;
  const hookServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      hookReceivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise(resolve => hookServer.listen(0, '127.0.0.1', resolve));
  const { port } = hookServer.address();
  const prevHookEnv = process.env.ADMIN_RBAC_DEPLOY_HOOK_URL;
  process.env.ADMIN_RBAC_DEPLOY_HOOK_URL = `http://127.0.0.1:${port}/deploy-hook`;

  try {
    const initial = await service.readCodeRbacState();
    const proposed = structuredClone(initial.catalog);
    proposed.features.push('compliance_audit');
    proposed.permissions.push(['compliance_audit', 'read']);
    proposed.rolePermissions.TENANT_OWNER.push('compliance_audit.read');

    const preview = await service.previewCodeRbacDiff(proposed);
    assert.equal(preview.valid, true);
    assert.ok(preview.diff.addedFeatures.includes('compliance_audit'));
    assert.ok(preview.lineDiff.some(l => l.type === 'add' && l.content.includes('compliance_audit')));

    const modified = await service.modifyCodeRbacCatalog({
      catalog: proposed,
      actor: 'superadmin@pharma.local',
      changeReference: 'RBAC-TEST-101',
      confirmation: 'APPLY CODE RBAC CHANGE',
      syncDatabase: false
    });
    assert.equal(modified.success, true);
    assert.ok(modified.snapshotId);

    const diskAfterModify = await fs.readFile(catalogPath, 'utf8');
    assert.ok(diskAfterModify.includes('compliance_audit.read'));
    assert.ok(diskAfterModify.includes('export async function ensureAuthorizationCatalog()'));

    const redeploy = await service.redeployCodeRbac({
      actor: 'superadmin@pharma.local',
      changeReference: 'RBAC-TEST-101',
      confirmation: 'CONFIRM REDEPLOY',
      environment: 'staging',
      bumpAllSessions: false
    });
    assert.equal(redeploy.success, true);
    assert.equal(redeploy.hookOutcome.triggered, true);
    assert.equal(redeploy.hookOutcome.httpStatus, 200);
    assert.equal(hookReceivedBody.changeReference, 'RBAC-TEST-101');
    assert.ok(redeploy.steps.every(step => step.status === 'PASSED' || step.status === 'SKIPPED_OFFLINE' || step.status === 'SKIPPED'));

    const rollback = await service.rollbackCodeRbacSnapshot({
      snapshotId: modified.snapshotId,
      actor: 'superadmin@pharma.local',
      confirmation: 'ROLLBACK CODE RBAC'
    });
    assert.equal(rollback.success, true);
    const afterRollback = await service.readCodeRbacState();
    assert.equal(afterRollback.catalog.features.includes('compliance_audit'), false);
  } finally {
    if (prevHookEnv === undefined) delete process.env.ADMIN_RBAC_DEPLOY_HOOK_URL;
    else process.env.ADMIN_RBAC_DEPLOY_HOOK_URL = prevHookEnv;
    await new Promise(resolve => hookServer.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
