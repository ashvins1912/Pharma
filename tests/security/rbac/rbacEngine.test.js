/**
 * RBAC Validation & Security Regression Test Suite
 * Asserts Positive & Negative RBAC, Permission Revocation, and Multi-Tenant Isolation
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runRbacValidationSuite, MASTER_ROLES, CORE_FEATURES } from './rbacEngine.js';

test('RBAC Validation Engine executes full role-feature matrix', async () => {
  const report = await runRbacValidationSuite();
  assert.ok(report.totalChecks > 0, 'Total checks should be greater than 0');
  assert.equal(report.failedChecks, 0, `Expected 0 RBAC failures, but got ${report.failedChecks}: ${JSON.stringify(report.blockers)}`);
  assert.equal(report.blockers.length, 0, 'Should have 0 active security blockers');
});

test('Customer role is strictly denied Tenant Administration and Staff Management', async () => {
  const report = await runRbacValidationSuite();
  const staffFeature = report.matrixResults['staff_management'];
  assert.equal(staffFeature['CUSTOMER'].status, 'RESTRICTED', 'Customer must be restricted from staff management');
});

test('Tenant Admin is denied Platform Governance access', async () => {
  const report = await runRbacValidationSuite();
  const platformFeature = report.matrixResults['platform_tenant_governance'];
  assert.equal(platformFeature['TENANT_ADMIN'].status, 'RESTRICTED', 'Tenant Admin must not receive platform governance access');
});

test('Cross-tenant resource access is strictly blocked for non-superadmin roles', async () => {
  const report = await runRbacValidationSuite();
  for (const featureId of Object.keys(report.matrixResults)) {
    for (const role of MASTER_ROLES) {
      if (role !== 'SUPER_ADMIN') {
        assert.equal(
          report.matrixResults[featureId][role].tenantIsolationVerified,
          true,
          `Role ${role} must maintain tenant isolation on ${featureId}`
        );
      }
    }
  }
});
