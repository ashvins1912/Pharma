import Feature from '../models/Feature.js';
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';
import RolePermission from '../models/RolePermission.js';
import { getIsConnected } from '../config/db.js';

const FEATURES = ['profile','mfa','inventory','orders','prescription','billing','referrals','tenants','tenant.profile','tenant.branches','users','platform','medicine_requests','csquare','promotions','whatsapp','delivery'];
const PERMISSIONS = [
  ['profile','view'],['profile','read'],['profile','write'],['profile','complete'],['mfa','verify'],['mfa','manage'],
  ['inventory','read'],['inventory','write'],['inventory','import'],
  ['orders','read'],['orders','create'],['orders','manage'],['promotions','read'],['promotions','manage'],
  ['prescription','read'],['prescription','write'],['prescription','review'],
  ['billing','read'],['billing','write'],['referrals','read'],['referrals','manage'],
  ['tenants','read'],['tenants','manage'],['tenant.profile','read'],['tenant.branches','read'],['tenant.branches','manage'],['users','read'],['users','manage'],
  ['medicine_requests','read'],['medicine_requests','pending_count'],['medicine_requests','create'],['medicine_requests','decide'],['medicine_requests','proposal'],['medicine_requests','manage'],['csquare','read'],['csquare','manage'],['csquare','sync'],
  ['platform','*'],['whatsapp','read'],['whatsapp','manage'],['delivery','read'],['delivery','manage']
];
const ROLE_PERMISSIONS = {
  SUPER_ADMIN:['*','platform.*'], PLATFORM_SUPER_ADMIN:['*','platform.*'], admin:['*','platform.*'],
  TENANT_OWNER:['profile.read','profile.write','delivery.read','delivery.manage','whatsapp.read','whatsapp.manage','csquare.read','csquare.manage','csquare.sync','medicine_requests.read','medicine_requests.pending_count','medicine_requests.proposal','medicine_requests.manage','inventory.read','inventory.write','orders.read','orders.create','orders.manage','prescription.read','prescription.write','prescription.review','billing.read','billing.write','referrals.read','referrals.manage','promotions.read','promotions.manage','tenants.read','tenants.manage','tenant.profile.read','tenant.branches.read','tenant.branches.manage','users.read','users.manage'],
  TENANT_ADMIN:['profile.read','profile.write','delivery.read','delivery.manage','whatsapp.read','whatsapp.manage','csquare.read','csquare.manage','csquare.sync','medicine_requests.read','medicine_requests.pending_count','medicine_requests.proposal','medicine_requests.manage','inventory.read','inventory.write','orders.read','orders.create','orders.manage','prescription.read','prescription.write','prescription.review','billing.read','billing.write','referrals.read','referrals.manage','promotions.read','promotions.manage','tenant.profile.read','tenant.branches.read','tenant.branches.manage','users.read'],
  PHARMACIST:['profile.read','profile.write','csquare.read','csquare.sync','medicine_requests.read','medicine_requests.pending_count','medicine_requests.proposal','promotions.read','promotions.manage','inventory.read','inventory.write','orders.read','orders.create','orders.manage','prescription.read','prescription.write','prescription.review'],
  PHARMACY_STAFF:['profile.read','profile.write','csquare.read','promotions.read','promotions.manage','medicine_requests.read','medicine_requests.pending_count','medicine_requests.proposal','inventory.read','orders.read','orders.create','prescription.read','prescription.write'],
  // Legacy pharmacy accounts are tenant pharmacy staff and must retain the same
  // medicine-request authority after the gateway/RBAC hardening rollout.
  pharmacy:['profile.read','profile.write','csquare.read','promotions.read','promotions.manage','medicine_requests.read','medicine_requests.pending_count','medicine_requests.proposal','inventory.read','orders.read','orders.create','prescription.read','prescription.write'],
  INVENTORY_MANAGER:['profile.read','profile.write','inventory.read','inventory.write'],
  ORDER_MANAGER:['profile.read','profile.write','orders.read','orders.create','orders.manage','delivery.read','delivery.manage'],
  CUSTOMER:['profile.read','profile.write','medicine_requests.read','medicine_requests.create','medicine_requests.decide','orders.read','orders.create','prescription.read','prescription.write'],
  customer:['profile.read','profile.write','medicine_requests.read','medicine_requests.create','medicine_requests.decide','orders.read','orders.create','prescription.read','prescription.write']
};
const ROLE_SCOPE = { SUPER_ADMIN:'PLATFORM', PLATFORM_SUPER_ADMIN:'PLATFORM', admin:'PLATFORM', TENANT_OWNER:'TENANT', TENANT_ADMIN:'TENANT', PHARMACIST:'TENANT', PHARMACY_STAFF:'TENANT', pharmacy:'TENANT', INVENTORY_MANAGER:'TENANT', ORDER_MANAGER:'TENANT', CUSTOMER:'CUSTOMER', customer:'CUSTOMER' };
const memory = {
  features: [...FEATURES],
  permissions: PERMISSIONS.map(([feature, action]) => [feature, action]),
  rolePermissions: new Map(Object.entries(ROLE_PERMISSIONS)),
  roleScope: { ...ROLE_SCOPE }
};

export function getCatalogDefinition() {
  return {
    features: [...memory.features],
    permissions: memory.permissions.map(([feature, action]) => [feature, action]),
    rolePermissions: Object.fromEntries(
      [...memory.rolePermissions.entries()].map(([role, perms]) => [role, [...perms]])
    ),
    roleScope: { ...memory.roleScope }
  };
}

export function applyCatalogSnapshot({
  features = FEATURES,
  permissions = PERMISSIONS,
  rolePermissions = ROLE_PERMISSIONS,
  roleScope = ROLE_SCOPE
} = {}) {
  memory.features = [...features];
  memory.permissions = permissions.map(([feature, action]) => [feature, action]);
  memory.rolePermissions = new Map(
    Object.entries(rolePermissions).map(([role, perms]) => [role, [...perms]])
  );
  memory.roleScope = { ...roleScope };
  return getCatalogDefinition();
}

export async function syncCatalogToDatabase({ deactivateMissing = false } = {}) {
  if (!getIsConnected()) {
    return { connected: false, synced: false, featuresUpserted: 0, permissionsUpserted: 0, rolesUpserted: 0, rolePermissionsActivated: 0, rolePermissionsDisabled: 0 };
  }
  const current = getCatalogDefinition();
  let featuresUpserted = 0;
  let permissionsUpserted = 0;
  let rolesUpserted = 0;
  let rolePermissionsActivated = 0;
  let rolePermissionsDisabled = 0;

  for (const code of current.features) {
    await Feature.findOneAndUpdate(
      { code },
      { $set: { status: 'ACTIVE' }, $setOnInsert: { code, name: code } },
      { upsert: true }
    );
    featuresUpserted += 1;
  }

  const activePermCodes = [];
  for (const [featureCode, action] of current.permissions) {
    const code = `${featureCode}.${action}`;
    activePermCodes.push(code);
    await Permission.findOneAndUpdate(
      { code },
      { $set: { featureCode, action, status: 'ACTIVE' }, $setOnInsert: { code } },
      { upsert: true }
    );
    permissionsUpserted += 1;
  }

  for (const [code, permissions] of Object.entries(current.rolePermissions)) {
    await Role.findOneAndUpdate(
      { code },
      { $set: { scope: current.roleScope[code] || 'CUSTOMER', status: 'ACTIVE' }, $setOnInsert: { code, name: code } },
      { upsert: true }
    );
    rolesUpserted += 1;
    for (const permissionCode of permissions) {
      await RolePermission.findOneAndUpdate(
        { roleCode: code, permissionCode },
        { $set: { status: 'ACTIVE' }, $setOnInsert: { roleCode: code, permissionCode } },
        { upsert: true }
      );
      rolePermissionsActivated += 1;
    }
    if (deactivateMissing) {
      const disabled = await RolePermission.updateMany(
        { roleCode: code, permissionCode: { $nin: permissions }, status: 'ACTIVE' },
        { $set: { status: 'DISABLED' } }
      );
      rolePermissionsDisabled += Number(disabled?.modifiedCount || 0);
    }
  }

  if (deactivateMissing) {
    await Feature.updateMany({ code: { $nin: current.features }, status: 'ACTIVE' }, { $set: { status: 'DISABLED' } });
    await Permission.updateMany({ code: { $nin: activePermCodes }, status: 'ACTIVE' }, { $set: { status: 'DISABLED' } });
  }

  return {
    connected: true,
    synced: true,
    featuresUpserted,
    permissionsUpserted,
    rolesUpserted,
    rolePermissionsActivated,
    rolePermissionsDisabled
  };
}

export async function ensureAuthorizationCatalog() {
  if (!getIsConnected()) return;
  const current = getCatalogDefinition();
  for (const code of current.features) await Feature.findOneAndUpdate({ code }, { $setOnInsert: { code, name: code } }, { upsert: true });
  for (const [featureCode, action] of current.permissions) {
    const code = featureCode + '.' + action;
    await Permission.findOneAndUpdate({ code }, { $setOnInsert: { code, featureCode, action } }, { upsert: true });
  }
  for (const [code, permissions] of Object.entries(current.rolePermissions)) {
    await Role.findOneAndUpdate({ code }, { $setOnInsert: { code, name: code, scope: current.roleScope[code] || 'CUSTOMER' } }, { upsert: true });
    for (const permissionCode of permissions) await RolePermission.findOneAndUpdate({ roleCode: code, permissionCode }, { $setOnInsert: { roleCode: code, permissionCode, status: 'ACTIVE' } }, { upsert: true });
  }
  // Inventory imports stay unavailable to tenant roles until controlled tenant/branch validation is complete.
  await RolePermission.updateMany(
    { roleCode: { $in: ['TENANT_OWNER', 'TENANT_ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER'] }, permissionCode: 'inventory.import' },
    { $set: { status: 'DISABLED' } }
  );
}

export async function getRolePermissions(roleCode) {
  if (!roleCode) return [];
  if (getIsConnected()) {
    const role = await Role.findOne({ code: roleCode, status: 'ACTIVE' }).lean();
    if (!role) return [...(memory.rolePermissions.get(roleCode) || [])];
    const rows = await RolePermission.find({ roleCode, status: 'ACTIVE' }).lean();
    // During startup, catalog seeding can lag the first authenticated request.
    // Keep the code-defined policy as a safe deterministic fallback rather than
    // turning a valid role into an unexplained empty-permission session.
    return rows.length
      ? rows.map(row => row.permissionCode)
      : [...(memory.rolePermissions.get(roleCode) || [])];
  }
  return [...(memory.rolePermissions.get(roleCode) || [])];
}

export function getRoleScope(roleCode) { return memory.roleScope[roleCode] || 'CUSTOMER'; }
export function isKnownPermission(permissionCode) {
  return memory.permissions.some(([feature, action]) => feature + '.' + action === permissionCode);
}
export const authorizationCatalog = {
  ensureAuthorizationCatalog,
  syncCatalogToDatabase,
  getRolePermissions,
  getRoleScope,
  getCatalogDefinition,
  applyCatalogSnapshot
};
