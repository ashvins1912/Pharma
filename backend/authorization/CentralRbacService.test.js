import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_ROLES,
  createCentralRbacService,
  resolveCanonicalTier
} from './CentralRbacService.js';
import {
  applyCatalogSnapshot,
  getCatalogDefinition
} from './AuthorizationCatalogService.js';

function createMockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    }
  };
}

function createFakeModels(initialUsers = []) {
  const store = initialUsers.map(item => ({ ...item }));
  const logs = [];
  const userUpdates = [];

  const toDoc = (raw) => ({
    ...raw,
    async save() {
      const idx = store.findIndex(u => u.userId === this.userId);
      if (idx >= 0) store[idx] = { ...this };
      else store.push({ ...this });
      return this;
    }
  });

  const userProfileModel = {
    find(filter = {}) {
      const filtered = store.filter(u => {
        if (filter.accountStatus?.$ne && u.accountStatus === filter.accountStatus.$ne) return false;
        if (filter.tenantId && String(u.tenantId || '') !== String(filter.tenantId)) return false;
        return true;
      });
      return {
        select() { return this; },
        sort() { return this; },
        limit() { return this; },
        async lean() { return filtered.map(item => ({ ...item })); }
      };
    },
    async findOne(query = {}) {
      const ors = query.$or || [query];
      const found = store.find(u => ors.some(cond =>
        (cond.userId && u.userId === cond.userId) ||
        (cond.supabase_user_id && u.supabase_user_id === cond.supabase_user_id) ||
        (cond.supabaseId && u.supabaseId === cond.supabaseId)
      ));
      return found ? toDoc(found) : null;
    },
    async countDocuments(query = {}) {
      const allowedRoles = query.role?.$in || [];
      return store.filter(u =>
        (!allowedRoles.length || allowedRoles.includes(u.role)) &&
        (!query.accountStatus || u.accountStatus === query.accountStatus)
      ).length;
    },
    async updateMany(_filter, _update) {
      return { modifiedCount: 1 };
    }
  };

  const userModel = {
    async updateMany(filter, update) {
      userUpdates.push({ filter, update });
      return { modifiedCount: 1 };
    }
  };

  const activityLogModel = {
    async create(entry) {
      logs.unshift({ ...entry });
      return entry;
    },
    find(query = {}) {
      const filtered = logs.filter(item => {
        if (query.action && item.action !== query.action) return false;
        if (query.outcome && item.outcome !== query.outcome) return false;
        return true;
      });
      return {
        sort() { return this; },
        limit(n) {
          this._limited = filtered.slice(0, n);
          return this;
        },
        async lean() { return this._limited || filtered; }
      };
    }
  };

  return { store, logs, userUpdates, userProfileModel, userModel, activityLogModel };
}

test('CentralRbacService defines Admin, Staff, and Customer canonical tiers accurately', () => {
  assert.deepEqual(Object.keys(CANONICAL_ROLES), ['Admin', 'Staff', 'Customer']);
  assert.equal(resolveCanonicalTier('SUPER_ADMIN'), 'Admin');
  assert.equal(resolveCanonicalTier('TENANT_ADMIN'), 'Admin');
  assert.equal(resolveCanonicalTier('PHARMACIST'), 'Staff');
  assert.equal(resolveCanonicalTier('PHARMACY_STAFF'), 'Staff');
  assert.equal(resolveCanonicalTier('CUSTOMER'), 'Customer');
  assert.equal(resolveCanonicalTier('unknown_role'), 'Customer');
});

test('validateOperationPermission & display/modify middlewares enforce Admin, Staff, and Customer policies and log denials', async () => {
  const { logs, userProfileModel, userModel, activityLogModel } = createFakeModels();
  const rbac = createCentralRbacService({
    userProfileModel,
    userModel,
    activityLogModel,
    isDbConnected: () => true
  });

  // 1. Customer blocked from admin display & modify
  const customerUser = { sub: 'cust-1', email: 'c@pharma.local', role: 'CUSTOMER', permissions: ['orders.read', 'users.manage'] };
  const custDisplay = await rbac.validateOperationPermission({ user: customerUser, operation: 'display', permission: 'users.read' });
  assert.equal(custDisplay.allowed, false);
  assert.equal(custDisplay.tier, 'Customer');

  const custModify = await rbac.validateOperationPermission({ user: customerUser, operation: 'modify', permission: 'users.manage' });
  assert.equal(custModify.allowed, false);

  // 2. Staff allowed operational display/modify when granted, but blocked on governance modify
  const staffUser = {
    sub: 'staff-1',
    email: 'staff@pharma.local',
    role: 'PHARMACY_STAFF',
    tenantId: 't-1',
    permissions: ['orders.read', 'orders.manage', 'users.manage']
  };
  const staffOrderModify = await rbac.validateOperationPermission({ user: staffUser, operation: 'modify', permission: 'orders.manage' });
  assert.equal(staffOrderModify.allowed, true);
  assert.equal(staffOrderModify.tier, 'Staff');

  const staffGovModify = await rbac.validateOperationPermission({ user: staffUser, operation: 'modify', permission: 'users.manage' });
  assert.equal(staffGovModify.allowed, false);

  // 3. Explicit revocation overrides granted permission
  const revokedAdmin = {
    sub: 'ta-1',
    email: 'ta@pharma.local',
    role: 'TENANT_ADMIN',
    scope: 'TENANT',
    tenantId: 't-1',
    permissions: ['users.read', 'users.manage'],
    revokedPermissions: ['users.manage']
  };
  const revokedCheck = await rbac.validateOperationPermission({ user: revokedAdmin, operation: 'modify', permission: 'users.manage' });
  assert.equal(revokedCheck.allowed, false);

  // 4. Middleware tests (401 unauthenticated, 403 denied + audit log, next() allowed)
  const mwModify = rbac.requireModifyPermission('users.manage', { resourceType: 'user_role' });
  const mwDisplay = rbac.requireDisplayPermission('users.read', { resourceType: 'role_policy', auditOnAllow: true });

  const unauthRes = createMockRes();
  let nextCalled = false;
  await mwModify({ params: {}, originalUrl: '/test' }, unauthRes, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(unauthRes.statusCode, 401);

  const deniedRes = createMockRes();
  await mwModify({ user: staffUser, params: { userId: 'u-2' }, originalUrl: '/api/v1/admin/rbac/governance/users/u-2/role' }, deniedRes, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(deniedRes.statusCode, 403);
  assert.ok(logs.some(entry => entry.action === 'MODIFY_ACCESS_DENIED' && entry.outcome === 'DENIED' && entry.actorTier === 'Staff'));

  const superAdmin = { sub: 'root-1', email: 'root@pharma.local', role: 'SUPER_ADMIN', scope: 'PLATFORM', permissions: ['*'] };
  const allowRes = createMockRes();
  let allowNext = false;
  await mwDisplay({ user: superAdmin, params: {}, originalUrl: '/api/v1/admin/rbac/governance/roles' }, allowRes, () => { allowNext = true; });
  assert.equal(allowNext, true);
  assert.ok(logs.some(entry => entry.action === 'DISPLAY_ACCESS_GRANTED' && entry.outcome === 'ALLOWED' && entry.actorTier === 'Admin'));
});

test('assignUserRole updates user role/overrides, protects invariants, and logs sensitive activity', async () => {
  const { store, logs, userUpdates, userProfileModel, userModel, activityLogModel } = createFakeModels([
    {
      userId: 'root-1',
      email: 'root@pharma.local',
      name: 'Root Admin',
      role: 'SUPER_ADMIN',
      roles: ['SUPER_ADMIN'],
      accountStatus: 'ACTIVE',
      permissionVersion: 1
    },
    {
      userId: 'ta-1',
      email: 'ta@pharma.local',
      name: 'Tenant Admin',
      role: 'TENANT_ADMIN',
      roles: ['TENANT_ADMIN'],
      tenantId: 'tenant-a',
      accountStatus: 'ACTIVE',
      permissionVersion: 1
    },
    {
      userId: 'u-cust',
      email: 'alice@pharma.local',
      name: 'Alice Customer',
      role: 'CUSTOMER',
      roles: ['CUSTOMER'],
      tenantId: 'tenant-a',
      accessGrants: [],
      accessRevokes: [],
      accountStatus: 'ACTIVE',
      permissionVersion: 2
    },
    {
      userId: 'u-other-tenant',
      email: 'bob@other.local',
      name: 'Bob Other',
      role: 'CUSTOMER',
      roles: ['CUSTOMER'],
      tenantId: 'tenant-b',
      accountStatus: 'ACTIVE',
      permissionVersion: 1
    }
  ]);

  const rbac = createCentralRbacService({
    userProfileModel,
    userModel,
    activityLogModel,
    isDbConnected: () => true
  });

  const superActor = { sub: 'root-1', email: 'root@pharma.local', role: 'SUPER_ADMIN', scope: 'PLATFORM' };
  const tenantAdminActor = { sub: 'ta-1', email: 'ta@pharma.local', role: 'TENANT_ADMIN', scope: 'TENANT', tenantId: 'tenant-a' };

  // Self-change blocked
  await assert.rejects(
    () => rbac.assignUserRole({ actor: superActor, targetUserId: 'root-1', role: 'CUSTOMER', reason: 'Self test' }),
    err => err.code === 'SELF_ROLE_CHANGE_BLOCKED'
  );

  // Tenant admin blocked on cross-tenant user
  await assert.rejects(
    () => rbac.assignUserRole({ actor: tenantAdminActor, targetUserId: 'u-other-tenant', role: 'Staff', reason: 'Cross tenant promote' }),
    err => err.code === 'TENANT_SCOPE_VIOLATION'
  );

  // Tenant admin blocked from escalating to SUPER_ADMIN
  await assert.rejects(
    () => rbac.assignUserRole({ actor: tenantAdminActor, targetUserId: 'u-cust', role: 'SUPER_ADMIN', reason: 'Escalate attempt' }),
    err => err.code === 'PRIVILEGE_ESCALATION_BLOCKED'
  );

  // Tenant admin promotes tenant-a customer to Staff with scoped grants/revokes
  const updated = await rbac.assignUserRole({
    actor: tenantAdminActor,
    targetUserId: 'u-cust',
    role: 'Staff',
    grants: ['inventory.write'],
    revokes: ['billing.write'],
    reason: 'Assign pharmacy counter staff role'
  });

  assert.equal(updated.user.role, 'PHARMACY_STAFF');
  assert.equal(updated.user.canonicalTier, 'Staff');
  assert.equal(updated.user.permissionVersion, 3);
  assert.deepEqual(updated.user.accessGrants, ['inventory.write']);
  assert.deepEqual(updated.user.accessRevokes, ['billing.write']);
  assert.equal(store.find(u => u.userId === 'u-cust').role, 'PHARMACY_STAFF');
  assert.equal(userUpdates.length, 1);
  assert.equal(logs[0].action, 'ROLE_ASSIGNED');
  assert.equal(logs[0].before.role, 'CUSTOMER');
  assert.equal(logs[0].after.role, 'PHARMACY_STAFF');

  const fetchedLogs = await rbac.listActivityLogs({ action: 'ROLE_ASSIGNED' });
  assert.ok(fetchedLogs.some(item => item.targetId === 'u-cust'));
});

test('updateRolePermissions updates role policy in memory and logs activity (then restores snapshot)', async () => {
  const originalCatalog = structuredClone(getCatalogDefinition());
  const { logs, userProfileModel, userModel, activityLogModel } = createFakeModels();
  const rbac = createCentralRbacService({
    userProfileModel,
    userModel,
    activityLogModel,
    isDbConnected: () => true
  });

  try {
    const superActor = { sub: 'root-1', email: 'root@pharma.local', role: 'SUPER_ADMIN', scope: 'PLATFORM' };
    const result = await rbac.updateRolePermissions({
      actor: superActor,
      roleCode: 'ORDER_MANAGER',
      permissions: ['orders.read', 'orders.manage', 'delivery.read'],
      reason: 'Add delivery read visibility to order managers'
    });

    assert.equal(result.role, 'ORDER_MANAGER');
    assert.equal(result.canonicalTier, 'Staff');
    assert.ok(result.permissions.includes('delivery.read'));
    assert.equal(logs[0].action, 'ROLE_PERMISSIONS_UPDATED');
    assert.equal(logs[0].targetId, 'ORDER_MANAGER');
  } finally {
    applyCatalogSnapshot(originalCatalog);
  }
});
