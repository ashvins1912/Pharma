import Feature from '../models/Feature.js';
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';
import RolePermission from '../models/RolePermission.js';
import { getIsConnected } from '../config/db.js';

const FEATURES = ['profile','mfa','inventory','orders','prescription','billing','referrals','tenants','users','platform'];
const PERMISSIONS = [
  ['profile','view'],['profile','complete'],['mfa','verify'],['mfa','manage'],
  ['inventory','read'],['inventory','write'],['inventory','import'],
  ['orders','read'],['orders','create'],['orders','manage'],
  ['prescription','read'],['prescription','write'],['prescription','review'],
  ['billing','read'],['billing','write'],['referrals','read'],['referrals','manage'],
  ['tenants','read'],['tenants','manage'],['users','read'],['users','manage'],['platform','*']
];
const ROLE_PERMISSIONS = {
  SUPER_ADMIN:['platform.*'], PLATFORM_SUPER_ADMIN:['platform.*'], admin:['platform.*'],
  TENANT_OWNER:['inventory.read','inventory.write','inventory.import','orders.read','orders.create','orders.manage','prescription.read','prescription.write','prescription.review','billing.read','billing.write','referrals.read','referrals.manage','tenants.read','tenants.manage','users.read','users.manage'],
  TENANT_ADMIN:['inventory.read','inventory.write','inventory.import','orders.read','orders.create','orders.manage','prescription.read','prescription.write','prescription.review','billing.read','billing.write','referrals.read','referrals.manage','users.read'],
  PHARMACIST:['inventory.read','inventory.write','inventory.import','orders.read','orders.create','orders.manage','prescription.read','prescription.write','prescription.review'],
  PHARMACY_STAFF:['inventory.read','orders.read','orders.create','prescription.read','prescription.write'],
  INVENTORY_MANAGER:['inventory.read','inventory.write','inventory.import'],
  ORDER_MANAGER:['orders.read','orders.create','orders.manage'],
  CUSTOMER:['orders.read','orders.create','prescription.read','prescription.write'],
  customer:['orders.read','orders.create','prescription.read','prescription.write']
};
const ROLE_SCOPE = { SUPER_ADMIN:'PLATFORM', PLATFORM_SUPER_ADMIN:'PLATFORM', admin:'PLATFORM', TENANT_OWNER:'TENANT', TENANT_ADMIN:'TENANT', PHARMACIST:'TENANT', PHARMACY_STAFF:'TENANT', INVENTORY_MANAGER:'TENANT', ORDER_MANAGER:'TENANT', CUSTOMER:'CUSTOMER', customer:'CUSTOMER' };
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
export const authorizationCatalog = { ensureAuthorizationCatalog, getRolePermissions, getRoleScope };
