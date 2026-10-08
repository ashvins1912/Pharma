import Feature from '../models/Feature.js';
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';
import RolePermission from '../models/RolePermission.js';
import { getIsConnected } from '../config/db.js';

const FEATURES = ['profile','mfa','inventory','orders','prescription','billing','referrals','tenants','users','platform','medicine_requests','csquare','promotions'];
const PERMISSIONS = [
  ['profile','view'],['profile','complete'],['mfa','verify'],['mfa','manage'],
  ['inventory','read'],['inventory','write'],['inventory','import'],
  ['orders','read'],['orders','create'],['orders','manage'],['promotions','read'],['promotions','manage'],
  ['prescription','read'],['prescription','write'],['prescription','review'],
  ['billing','read'],['billing','write'],['referrals','read'],['referrals','manage'],
  ['tenants','read'],['tenants','manage'],['users','read'],['users','manage'],
  ['medicine_requests','read'],['medicine_requests','pending_count'],['medicine_requests','create'],['medicine_requests','decide'],['medicine_requests','proposal'],['medicine_requests','manage'],['csquare','read'],['csquare','manage'],['csquare','sync'],
  ['platform','*']
];
const ROLE_PERMISSIONS = {
  SUPER_ADMIN:['platform.*'], PLATFORM_SUPER_ADMIN:['platform.*'], admin:['platform.*'],
  TENANT_OWNER:['csquare.read','csquare.manage','csquare.sync','medicine_requests.read','medicine_requests.pending_count','medicine_requests.proposal','medicine_requests.manage','inventory.read','inventory.write','inventory.import','orders.read','orders.create','orders.manage','prescription.read','prescription.write','prescription.review','billing.read','billing.write','referrals.read','referrals.manage','promotions.read','promotions.manage','tenants.read','tenants.manage','users.read','users.manage'],
  TENANT_ADMIN:['csquare.read','csquare.manage','csquare.sync','medicine_requests.read','medicine_requests.pending_count','medicine_requests.proposal','medicine_requests.manage','inventory.read','inventory.write','inventory.import','orders.read','orders.create','orders.manage','prescription.read','prescription.write','prescription.review','billing.read','billing.write','referrals.read','referrals.manage','promotions.read','promotions.manage','users.read'],
  PHARMACIST:['csquare.read','csquare.sync','medicine_requests.read','medicine_requests.pending_count','medicine_requests.proposal','promotions.read','promotions.manage','inventory.read','inventory.write','inventory.import','orders.read','orders.create','orders.manage','prescription.read','prescription.write','prescription.review'],
  PHARMACY_STAFF:['csquare.read','promotions.read','promotions.manage','medicine_requests.read','medicine_requests.pending_count','medicine_requests.proposal','inventory.read','orders.read','orders.create','prescription.read','prescription.write'],
  // Legacy pharmacy accounts are tenant pharmacy staff and must retain the same
  // medicine-request authority after the gateway/RBAC hardening rollout.
  pharmacy:['csquare.read','promotions.read','promotions.manage','medicine_requests.read','medicine_requests.pending_count','medicine_requests.proposal','inventory.read','orders.read','orders.create','prescription.read','prescription.write'],
  INVENTORY_MANAGER:['inventory.read','inventory.write','inventory.import'],
  ORDER_MANAGER:['orders.read','orders.create','orders.manage'],
  CUSTOMER:['medicine_requests.read','medicine_requests.create','medicine_requests.decide','orders.read','orders.create','prescription.read','prescription.write'],
  customer:['medicine_requests.read','medicine_requests.create','medicine_requests.decide','orders.read','orders.create','prescription.read','prescription.write']
};
const ROLE_SCOPE = { SUPER_ADMIN:'PLATFORM', PLATFORM_SUPER_ADMIN:'PLATFORM', admin:'PLATFORM', TENANT_OWNER:'TENANT', TENANT_ADMIN:'TENANT', PHARMACIST:'TENANT', PHARMACY_STAFF:'TENANT', pharmacy:'TENANT', INVENTORY_MANAGER:'TENANT', ORDER_MANAGER:'TENANT', CUSTOMER:'CUSTOMER', customer:'CUSTOMER' };
const memory = {
  rolePermissions: new Map(Object.entries(ROLE_PERMISSIONS))
};

export async function ensureAuthorizationCatalog() {
  if (!getIsConnected()) return;
  for (const code of FEATURES) await Feature.findOneAndUpdate({ code }, { $setOnInsert: { code, name: code } }, { upsert: true });
  for (const [featureCode, action] of PERMISSIONS) {
    const code = featureCode + '.' + action;
    await Permission.findOneAndUpdate({ code }, { $setOnInsert: { code, featureCode, action } }, { upsert: true });
  }
  for (const [code, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    await Role.findOneAndUpdate({ code }, { $setOnInsert: { code, name: code, scope: ROLE_SCOPE[code] || 'CUSTOMER' } }, { upsert: true });
    for (const permissionCode of permissions) await RolePermission.findOneAndUpdate({ roleCode: code, permissionCode }, { $setOnInsert: { roleCode: code, permissionCode, status: 'ACTIVE' } }, { upsert: true });
  }
}

export async function getRolePermissions(roleCode) {
  if (!roleCode) return [];
  if (getIsConnected()) {
    const role = await Role.findOne({ code: roleCode, status: 'ACTIVE' }).lean();
    if (!role) return [];
    const rows = await RolePermission.find({ roleCode, status: 'ACTIVE' }).lean();
    return rows.map(row => row.permissionCode);
  }
  return [...(memory.rolePermissions.get(roleCode) || [])];
}

export function getRoleScope(roleCode) { return ROLE_SCOPE[roleCode] || 'CUSTOMER'; }
export function isKnownPermission(permissionCode) {
  return PERMISSIONS.some(([feature, action]) => feature + '.' + action === permissionCode);
}
export const authorizationCatalog = { ensureAuthorizationCatalog, getRolePermissions, getRoleScope };
