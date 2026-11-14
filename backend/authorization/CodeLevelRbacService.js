import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import Feature from '../models/Feature.js';
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';
import RolePermission from '../models/RolePermission.js';
import UserProfile from '../models/UserProfile.js';
import { getIsConnected } from '../config/db.js';
import {
  applyCatalogSnapshot,
  syncCatalogToDatabase
} from './AuthorizationCatalogService.js';
import {
  generateDeploymentFiles,
  validateGeneratedArtifact
} from '../services/devopsDeploymentKit.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

export const DEFAULT_CATALOG_PATH = path.join(REPO_ROOT, 'backend/authorization/AuthorizationCatalogService.js');
export const DEFAULT_GATEWAY_CAPABILITY_PATH = path.join(REPO_ROOT, 'api-gateway/src/apiCapabilityRegistry.js');
export const DEFAULT_SNAPSHOT_DIR = path.join(REPO_ROOT, 'backend/authorization/.rbac-snapshots');

const RESTRICTED_FEATURES = new Set(['platform', 'tenants', 'users']);
const RESTRICTED_PERMISSIONS = new Set([
  '*',
  'platform.*',
  'tenants.read',
  'tenants.manage',
  'users.read',
  'users.manage',
  'inventory.import'
]);
const PLATFORM_ADMIN_ROLES = ['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'admin'];
const VALID_SCOPES = new Set(['PLATFORM', 'TENANT', 'CUSTOMER']);

function sha256(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function extractDeclarativeBlock(sourceText) {
  const lines = String(sourceText || '').split(/\r?\n/);
  const startIdx = lines.findIndex(line => /^\s*const\s+FEATURES\s*=/.test(line));
  const memoryIdx = lines.findIndex((line, idx) => idx > startIdx && /^\s*const\s+memory\s*=/.test(line));
  if (startIdx === -1 || memoryIdx === -1) {
    throw Object.assign(
      new Error('Could not locate declarative RBAC block (FEATURES .. ROLE_SCOPE) in AuthorizationCatalogService.js.'),
      { code: 'RBAC_SOURCE_PARSE_ERROR', statusCode: 500 }
    );
  }
  const endIdx = memoryIdx - 1;
  const blockText = lines.slice(startIdx, endIdx + 1).join('\n');
  return {
    lines,
    startLine: startIdx + 1,
    endLine: endIdx + 1,
    blockText
  };
}

function evaluateDeclarativeBlock(blockText) {
  const sandbox = Object.create(null);
  const script = new vm.Script(
    `"use strict";\n${blockText}\n;({ FEATURES, PERMISSIONS, ROLE_PERMISSIONS, ROLE_SCOPE });`
  );
  const parsed = script.runInNewContext(sandbox, { timeout: 500 });
  if (
    !parsed ||
    !Array.isArray(parsed.FEATURES) ||
    !Array.isArray(parsed.PERMISSIONS) ||
    typeof parsed.ROLE_PERMISSIONS !== 'object' ||
    typeof parsed.ROLE_SCOPE !== 'object'
  ) {
    throw Object.assign(new Error('Evaluated RBAC catalog structure is invalid.'), {
      code: 'RBAC_CATALOG_INVALID',
      statusCode: 500
    });
  }
  return {
    features: parsed.FEATURES.map(String),
    permissions: parsed.PERMISSIONS.map(([f, a]) => [String(f), String(a)]),
    rolePermissions: Object.fromEntries(
      Object.entries(parsed.ROLE_PERMISSIONS).map(([role, perms]) => [String(role), (perms || []).map(String)])
    ),
    roleScope: Object.fromEntries(
      Object.entries(parsed.ROLE_SCOPE).map(([role, scope]) => [String(role), String(scope)])
    )
  };
}

function parseGatewayCapabilities(gatewaySource) {
  const bindings = [];
  const capSectionMatch = String(gatewaySource || '').match(/const\s+CAPABILITIES\s*=\s*\[([\s\S]*?)\n\];/);
  if (!capSectionMatch) return bindings;
  const entryRegex = /\[\s*['"]([A-Z]+)['"]\s*,\s*(\/(?:\\.|[^/\n])+\/[a-z]*)\s*,\s*['"]([^'"]+)['"]\s*\]/g;
  let match;
  while ((match = entryRegex.exec(capSectionMatch[1])) !== null) {
    const permission = match[3];
    const [feature] = permission.split('.');
    bindings.push({
      method: match[1],
      pattern: match[2],
      permission,
      feature
    });
  }
  return bindings;
}

export function detectPrivilegeConflicts(catalog) {
  const conflicts = [];
  const rolePermissions = catalog?.rolePermissions || {};
  const roleScope = catalog?.roleScope || {};

  for (const [role, perms] of Object.entries(rolePermissions)) {
    const scope = roleScope[role] || 'CUSTOMER';
    const isPlatformRole = PLATFORM_ADMIN_ROLES.includes(role) || scope === 'PLATFORM';
    if (isPlatformRole) continue;

    for (const perm of perms || []) {
      const [feature] = String(perm).split('.');
      if (perm === '*' || RESTRICTED_FEATURES.has(feature) || RESTRICTED_PERMISSIONS.has(perm)) {
        const severity = perm === '*' || feature === 'platform' || perm === 'users.manage' || perm === 'tenants.manage'
          ? 'HIGH'
          : 'MEDIUM';
        conflicts.push({
          role,
          scope,
          feature,
          permission: perm,
          severity,
          message: `Role ${role} (${scope}) has restricted privilege "${perm}".`
        });
      }
    }
  }
  return conflicts;
}

export function validateCatalogPayload(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['RBAC catalog payload must be an object.'], catalog: null };
  }

  const rawFeatures = Array.isArray(input.features) ? input.features : [];
  const rawPermissions = Array.isArray(input.permissions) ? input.permissions : [];
  const rawRolePermissions = input.rolePermissions && typeof input.rolePermissions === 'object' ? input.rolePermissions : null;
  const rawRoleScope = input.roleScope && typeof input.roleScope === 'object' ? input.roleScope : null;

  if (!rawFeatures.length) errors.push('At least one feature must be defined.');
  if (!rawPermissions.length) errors.push('At least one permission must be defined.');
  if (!rawRolePermissions) errors.push('rolePermissions map is required.');
  if (!rawRoleScope) errors.push('roleScope map is required.');

  const featureSet = new Set();
  const features = [];
  for (const item of rawFeatures) {
    const code = String(item || '').trim();
    if (!/^[a-z][a-z0-9._-]{1,63}$/.test(code)) {
      errors.push(`Invalid feature code "${code}". Use lowercase letters, numbers, '.', '_' or '-'.`);
      continue;
    }
    if (!featureSet.has(code)) {
      featureSet.add(code);
      features.push(code);
    }
  }

  const permCodeSet = new Set();
  const permissions = [];
  for (const entry of rawPermissions) {
    let featureCode = '';
    let action = '';
    if (Array.isArray(entry) && entry.length >= 2) {
      featureCode = String(entry[0] || '').trim();
      action = String(entry[1] || '').trim();
    } else if (typeof entry === 'string' && entry.includes('.')) {
      const idx = entry.lastIndexOf('.');
      featureCode = entry.slice(0, idx).trim();
      action = entry.slice(idx + 1).trim();
    } else {
      errors.push(`Invalid permission tuple: ${JSON.stringify(entry)}.`);
      continue;
    }

    if (!featureSet.has(featureCode)) {
      errors.push(`Permission "${featureCode}.${action}" references unknown feature "${featureCode}".`);
      continue;
    }
    if (!/^(?:\*|[a-z][a-z0-9_]{1,47})$/.test(action)) {
      errors.push(`Invalid permission action "${action}" on feature "${featureCode}".`);
      continue;
    }
    const fullCode = `${featureCode}.${action}`;
    if (!permCodeSet.has(fullCode)) {
      permCodeSet.add(fullCode);
      permissions.push([featureCode, action]);
    }
  }

  const rolePermissions = {};
  const roleScope = {};
  if (rawRolePermissions && rawRoleScope) {
    for (const [rawRole, rawPerms] of Object.entries(rawRolePermissions)) {
      const role = String(rawRole || '').trim();
      if (!/^[A-Za-z][A-Za-z0-9_]{1,47}$/.test(role)) {
        errors.push(`Invalid role identifier "${role}".`);
        continue;
      }
      const scope = String(rawRoleScope[role] || 'CUSTOMER').trim().toUpperCase();
      if (!VALID_SCOPES.has(scope)) {
        errors.push(`Role "${role}" has invalid scope "${scope}". Expected PLATFORM, TENANT, or CUSTOMER.`);
      }
      roleScope[role] = scope;

      const list = Array.isArray(rawPerms) ? rawPerms : [];
      const deduped = [];
      const seen = new Set();
      for (const p of list) {
        const permCode = String(p || '').trim();
        if (!permCode) continue;
        if (permCode !== '*' && !permCodeSet.has(permCode)) {
          errors.push(`Role "${role}" references unknown permission "${permCode}".`);
          continue;
        }
        if (!seen.has(permCode)) {
          seen.add(permCode);
          deduped.push(permCode);
        }
      }
      rolePermissions[role] = deduped;
    }

    for (const adminRole of PLATFORM_ADMIN_ROLES) {
      const assigned = rolePermissions[adminRole];
      if (!Array.isArray(assigned) || !assigned.includes('*')) {
        errors.push(`Platform safety invariant violated: ${adminRole} must retain "*" permission.`);
      }
      if (roleScope[adminRole] !== 'PLATFORM') {
        errors.push(`Platform safety invariant violated: ${adminRole} must use PLATFORM scope.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    catalog: { features, permissions, rolePermissions, roleScope }
  };
}

export function renderDeclarativeBlock(catalog) {
  const featuresLine = `const FEATURES = [${catalog.features.map(f => `'${f}'`).join(',')}];`;

  const groupedPerms = [];
  let currentGroup = [];
  for (let i = 0; i < catalog.permissions.length; i += 1) {
    const [feat, action] = catalog.permissions[i];
    currentGroup.push(`['${feat}','${action}']`);
    if (currentGroup.length === 6 || i === catalog.permissions.length - 1) {
      groupedPerms.push(`  ${currentGroup.join(',')}`);
      currentGroup = [];
    }
  }
  const permissionsBlock = `const PERMISSIONS = [\n${groupedPerms.join(',\n')}\n];`;

  const roleLines = Object.entries(catalog.rolePermissions).map(([role, perms]) => {
    const items = perms.map(p => `'${p}'`).join(',');
    return `  ${role}:[${items}]`;
  });
  const rolePermissionsBlock = `const ROLE_PERMISSIONS = {\n${roleLines.join(',\n')}\n};`;

  const scopeEntries = Object.entries(catalog.roleScope).map(([role, scope]) => `${role}:'${scope}'`);
  const roleScopeLine = `const ROLE_SCOPE = { ${scopeEntries.join(', ')} };`;

  return `${featuresLine}\n${permissionsBlock}\n${rolePermissionsBlock}\n${roleScopeLine}`;
}

export function computeCatalogDiff(currentCatalog, nextCatalog) {
  const currentFeatures = new Set(currentCatalog.features || []);
  const nextFeatures = new Set(nextCatalog.features || []);
  const addedFeatures = [...nextFeatures].filter(f => !currentFeatures.has(f));
  const removedFeatures = [...currentFeatures].filter(f => !nextFeatures.has(f));

  const currentPerms = new Set((currentCatalog.permissions || []).map(([f, a]) => `${f}.${a}`));
  const nextPerms = new Set((nextCatalog.permissions || []).map(([f, a]) => `${f}.${a}`));
  const addedDefinedPermissions = [...nextPerms].filter(p => !currentPerms.has(p));
  const removedDefinedPermissions = [...currentPerms].filter(p => !nextPerms.has(p));

  const allRoles = new Set([
    ...Object.keys(currentCatalog.rolePermissions || {}),
    ...Object.keys(nextCatalog.rolePermissions || {})
  ]);
  const roleChanges = [];
  for (const role of allRoles) {
    const prevList = new Set(currentCatalog.rolePermissions?.[role] || []);
    const nextList = new Set(nextCatalog.rolePermissions?.[role] || []);
    const added = [...nextList].filter(p => !prevList.has(p));
    const removed = [...prevList].filter(p => !nextList.has(p));
    const prevScope = currentCatalog.roleScope?.[role] || null;
    const nextScope = nextCatalog.roleScope?.[role] || null;
    if (added.length || removed.length || prevScope !== nextScope) {
      roleChanges.push({
        role,
        addedPermissions: added,
        removedPermissions: removed,
        previousScope: prevScope,
        nextScope
      });
    }
  }

  return {
    hasChanges: Boolean(
      addedFeatures.length ||
      removedFeatures.length ||
      addedDefinedPermissions.length ||
      removedDefinedPermissions.length ||
      roleChanges.length
    ),
    addedFeatures,
    removedFeatures,
    addedDefinedPermissions,
    removedDefinedPermissions,
    roleChanges
  };
}

function buildLineDiff(beforeText, afterText) {
  const beforeLines = String(beforeText || '').split(/\r?\n/);
  const afterLines = String(afterText || '').split(/\r?\n/);
  const diff = [];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i += 1) {
    const prev = beforeLines[i];
    const next = afterLines[i];
    if (prev === next) {
      diff.push({ type: 'context', lineNumber: i + 1, content: next });
    } else {
      if (prev !== undefined) diff.push({ type: 'remove', lineNumber: i + 1, content: prev });
      if (next !== undefined) diff.push({ type: 'add', lineNumber: i + 1, content: next });
    }
  }
  return diff;
}

function validateDeployHookUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return null;
  const parsed = new URL(raw);
  const isProd = process.env.NODE_ENV === 'production';
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !( !isProd && parsed.protocol === 'http:' && isLoopback )) {
    throw Object.assign(
      new Error('Deploy hook URL must use HTTPS (loopback HTTP allowed only outside production).'),
      { code: 'INVALID_DEPLOY_HOOK_URL', statusCode: 400 }
    );
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(
      new Error('Deploy hook URL must not embed credentials.'),
      { code: 'INVALID_DEPLOY_HOOK_URL', statusCode: 400 }
    );
  }
  return parsed.toString();
}

export function createCodeLevelRbacService({
  catalogPath = DEFAULT_CATALOG_PATH,
  gatewayCapabilityPath = DEFAULT_GATEWAY_CAPABILITY_PATH,
  snapshotDir = DEFAULT_SNAPSHOT_DIR
} = {}) {
  const isLiveCatalog = path.resolve(catalogPath) === path.resolve(DEFAULT_CATALOG_PATH);

  async function readCatalogFromDisk() {
    const sourceText = await fs.readFile(catalogPath, 'utf8');
    const block = extractDeclarativeBlock(sourceText);
    const catalog = evaluateDeclarativeBlock(block.blockText);
    return { sourceText, block, catalog };
  }

  async function readDatabaseDrift(codeCatalog) {
    if (!getIsConnected()) {
      return {
        connected: false,
        inSync: null,
        missingFeaturesInDb: [],
        missingPermissionsInDb: [],
        missingRolePermissionsInDb: [],
        extraRolePermissionsInDb: []
      };
    }

    const [dbFeatures, dbPermissions, dbRolePermissions] = await Promise.all([
      Feature.find({ status: 'ACTIVE' }).select('code').lean(),
      Permission.find({ status: 'ACTIVE' }).select('code').lean(),
      RolePermission.find({ status: 'ACTIVE' }).select('roleCode permissionCode').lean()
    ]);

    const dbFeatSet = new Set(dbFeatures.map(f => f.code));
    const dbPermSet = new Set(dbPermissions.map(p => p.code));
    const dbRpSet = new Set(dbRolePermissions.map(rp => `${rp.roleCode}::${rp.permissionCode}`));

    const codeRpSet = new Set();
    for (const [role, perms] of Object.entries(codeCatalog.rolePermissions)) {
      for (const p of perms) codeRpSet.add(`${role}::${p}`);
    }

    const missingFeaturesInDb = codeCatalog.features.filter(f => !dbFeatSet.has(f));
    const missingPermissionsInDb = codeCatalog.permissions
      .map(([f, a]) => `${f}.${a}`)
      .filter(code => !dbPermSet.has(code));
    const missingRolePermissionsInDb = [...codeRpSet]
      .filter(pair => !dbRpSet.has(pair))
      .map(pair => {
        const [roleCode, permissionCode] = pair.split('::');
        return { roleCode, permissionCode };
      });
    const extraRolePermissionsInDb = [...dbRpSet]
      .filter(pair => !codeRpSet.has(pair))
      .map(pair => {
        const [roleCode, permissionCode] = pair.split('::');
        return { roleCode, permissionCode };
      });

    const inSync =
      missingFeaturesInDb.length === 0 &&
      missingPermissionsInDb.length === 0 &&
      missingRolePermissionsInDb.length === 0 &&
      extraRolePermissionsInDb.length === 0;

    return {
      connected: true,
      inSync,
      counts: {
        featuresInDb: dbFeatures.length,
        permissionsInDb: dbPermissions.length,
        activeRoleBindingsInDb: dbRolePermissions.length
      },
      missingFeaturesInDb,
      missingPermissionsInDb,
      missingRolePermissionsInDb,
      extraRolePermissionsInDb
    };
  }

  async function listSnapshots(limit = 20) {
    try {
      const files = await fs.readdir(snapshotDir);
      const jsonFiles = files.filter(name => name.endsWith('.json')).sort().reverse().slice(0, limit);
      const items = [];
      for (const file of jsonFiles) {
        try {
          const raw = await fs.readFile(path.join(snapshotDir, file), 'utf8');
          const parsed = JSON.parse(raw);
          items.push({
            snapshotId: parsed.snapshotId,
            createdAt: parsed.createdAt,
            actor: parsed.actor,
            changeReference: parsed.changeReference,
            previousDigest: parsed.previousDigest,
            nextDigest: parsed.nextDigest,
            action: parsed.action || 'MODIFY',
            summary: parsed.summary || null
          });
        } catch {
          // Skip malformed snapshot file cleanly
        }
      }
      return items;
    } catch {
      return [];
    }
  }

  async function writeSnapshot(record) {
    await fs.mkdir(snapshotDir, { recursive: true });
    const safeId = String(record.snapshotId).replace(/[^a-zA-Z0-9._-]/g, '_');
    const target = path.join(snapshotDir, `${safeId}.json`);
    await fs.writeFile(target, JSON.stringify(record, null, 2) + '\n', 'utf8');
    return record.snapshotId;
  }

  async function readCodeRbacState() {
    const [{ sourceText, block, catalog }, gatewayRaw, snapshots] = await Promise.all([
      readCatalogFromDisk(),
      fs.readFile(gatewayCapabilityPath, 'utf8').catch(() => ''),
      listSnapshots(15)
    ]);

    const databaseSync = await readDatabaseDrift(catalog);
    const conflicts = detectPrivilegeConflicts(catalog);
    const routeBindings = parseGatewayCapabilities(gatewayRaw);
    const deployHookConfigured = Boolean(
      String(process.env.ADMIN_RBAC_DEPLOY_HOOK_URL || process.env.RENDER_DEPLOY_HOOK_URL || '').trim()
    );

    return {
      sourceFile: path.relative(REPO_ROOT, catalogPath) || catalogPath,
      lineRange: { startLine: block.startLine, endLine: block.endLine },
      fileDigest: sha256(sourceText),
      policyDigest: sha256(block.blockText),
      policySource: block.blockText,
      catalog,
      conflicts,
      routeBindings,
      databaseSync,
      deployReadiness: {
        deployHookConfigured,
        mode: deployHookConfigured ? 'REMOTE_HOOK_AND_HOT_RELOAD' : 'HOT_RELOAD_AND_DB_SYNC',
        totalRoles: Object.keys(catalog.rolePermissions).length,
        totalFeatures: catalog.features.length,
        totalPermissions: catalog.permissions.length,
        totalRouteBindings: routeBindings.length
      },
      snapshots
    };
  }

  async function previewCodeRbacDiff(proposedInput) {
    const { block, catalog: currentCatalog } = await readCatalogFromDisk();
    const validation = validateCatalogPayload(proposedInput);
    if (!validation.valid) {
      return {
        valid: false,
        errors: validation.errors,
        conflicts: [],
        diff: null,
        lineDiff: [],
        renderedBlock: ''
      };
    }

    const nextCatalog = validation.catalog;
    const diff = computeCatalogDiff(currentCatalog, nextCatalog);
    const renderedBlock = renderDeclarativeBlock(nextCatalog);
    const conflicts = detectPrivilegeConflicts(nextCatalog);
    const lineDiff = buildLineDiff(block.blockText, renderedBlock);

    return {
      valid: true,
      errors: [],
      conflicts,
      diff,
      lineDiff,
      renderedBlock,
      currentPolicyDigest: sha256(block.blockText),
      nextPolicyDigest: sha256(renderedBlock)
    };
  }

  async function bumpModifiedUsersPermissionVersion(modifiedRoles = []) {
    if (!getIsConnected() || mongoose.connection?.readyState !== 1) {
      return { updatedUsers: 0 };
    }
    const query = modifiedRoles.length
      ? { $or: [{ role: { $in: modifiedRoles } }, { roles: { $in: modifiedRoles } }] }
      : {};
    const res = await UserProfile.updateMany(query, { $inc: { permissionVersion: 1 } });
    return { updatedUsers: Number(res?.modifiedCount || 0) };
  }

  async function writeCatalogBlockToDisk(newBlockText) {
    const sourceText = await fs.readFile(catalogPath, 'utf8');
    const block = extractDeclarativeBlock(sourceText);
    const lines = block.lines;
    const beforeLines = lines.slice(0, block.startLine - 1);
    const afterLines = lines.slice(block.endLine);
    const updatedSource = [...beforeLines, ...newBlockText.split('\n'), ...afterLines].join('\n');

    const tempPath = `${catalogPath}.tmp-${crypto.randomUUID()}.mjs`;
    await fs.writeFile(tempPath, updatedSource, 'utf8');
    try {
      await execFileAsync(process.execPath, ['--check', tempPath], { timeout: 10000 });
      await fs.rename(tempPath, catalogPath);
    } catch (err) {
      await fs.unlink(tempPath).catch(() => {});
      throw Object.assign(new Error(`Generated RBAC code failed syntax check: ${err.message}`), {
        code: 'RBAC_SYNTAX_CHECK_FAILED',
        statusCode: 500
      });
    }
    return updatedSource;
  }

  async function modifyCodeRbacCatalog({
    catalog: proposedInput,
    actor = 'unknown-super-admin',
    changeReference = '',
    confirmation = '',
    syncDatabase = true,
    allowConflicts = false
  } = {}) {
    const reference = String(changeReference || '').trim();
    if (reference.length < 3 || reference.length > 120) {
      throw Object.assign(
        new Error('A change or ticket reference (3-120 characters) is required to modify code-level RBAC.'),
        { code: 'CHANGE_REFERENCE_REQUIRED', statusCode: 400 }
      );
    }
    if (confirmation !== 'APPLY CODE RBAC CHANGE') {
      throw Object.assign(
        new Error('Type APPLY CODE RBAC CHANGE to confirm modifying repository RBAC code.'),
        { code: 'CONFIRMATION_REQUIRED', statusCode: 400 }
      );
    }

    const { sourceText, block, catalog: currentCatalog } = await readCatalogFromDisk();
    const validation = validateCatalogPayload(proposedInput);
    if (!validation.valid) {
      throw Object.assign(new Error(validation.errors.join(' ')), {
        code: 'INVALID_RBAC_CATALOG',
        statusCode: 422,
        details: validation.errors
      });
    }

    const nextCatalog = validation.catalog;
    const existingConflictKeys = new Set(
      detectPrivilegeConflicts(currentCatalog).map(c => `${c.role}::${c.permission}`)
    );
    const conflicts = detectPrivilegeConflicts(nextCatalog);
    const newlyIntroducedHighConflicts = conflicts.filter(
      c => c.severity === 'HIGH' && !existingConflictKeys.has(`${c.role}::${c.permission}`)
    );
    if (newlyIntroducedHighConflicts.length && !allowConflicts) {
      throw Object.assign(
        new Error(`High-privilege conflict detected: ${newlyIntroducedHighConflicts[0].message} Confirm override to proceed.`),
        { code: 'PRIVILEGE_CONFLICT_DETECTED', statusCode: 409, details: newlyIntroducedHighConflicts }
      );
    }

    const diff = computeCatalogDiff(currentCatalog, nextCatalog);
    const renderedBlock = renderDeclarativeBlock(nextCatalog);
    const previousDigest = sha256(block.blockText);
    const nextDigest = sha256(renderedBlock);
    const snapshotId = `rbac-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;

    await writeSnapshot({
      snapshotId,
      action: 'MODIFY',
      createdAt: new Date().toISOString(),
      actor: String(actor),
      changeReference: reference,
      previousDigest,
      nextDigest,
      previousBlock: block.blockText,
      previousCatalog: currentCatalog,
      previousFileDigest: sha256(sourceText),
      summary: {
        modifiedRoles: diff.roleChanges.map(r => r.role),
        addedFeatures: diff.addedFeatures,
        removedFeatures: diff.removedFeatures
      }
    });

    const updatedSource = await writeCatalogBlockToDisk(renderedBlock);

    if (isLiveCatalog) {
      applyCatalogSnapshot(nextCatalog);
    }

    let dbSyncResult = { connected: false, synced: false };
    let sessionBump = { updatedUsers: 0 };
    if (syncDatabase) {
      dbSyncResult = await syncCatalogToDatabase({ deactivateMissing: true });
      const modifiedRoles = diff.roleChanges.map(r => r.role);
      sessionBump = await bumpModifiedUsersPermissionVersion(modifiedRoles);
    }

    return {
      success: true,
      snapshotId,
      previousDigest,
      nextDigest,
      fileDigest: sha256(updatedSource),
      diff,
      conflicts,
      hotReloaded: isLiveCatalog,
      databaseSync: dbSyncResult,
      sessionBump,
      catalog: nextCatalog
    };
  }

  async function redeployCodeRbac({
    actor = 'unknown-super-admin',
    changeReference = 'MANUAL-REDEPLOY',
    confirmation = '',
    environment = process.env.NODE_ENV === 'production' ? 'production' : 'staging',
    bumpAllSessions = true
  } = {}) {
    if (confirmation !== 'CONFIRM REDEPLOY') {
      throw Object.assign(
        new Error('Type CONFIRM REDEPLOY to execute the RBAC control-plane redeploy.'),
        { code: 'CONFIRMATION_REQUIRED', statusCode: 400 }
      );
    }

    const deploymentId = `rbac-deploy-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const steps = [];

    // Step 1: Node syntax verification on disk
    const syntaxStart = Date.now();
    const diskText = await fs.readFile(catalogPath, 'utf8');
    const syntaxCheckPath = `${catalogPath}.check-${crypto.randomUUID()}.mjs`;
    await fs.writeFile(syntaxCheckPath, diskText, 'utf8');
    try {
      await execFileAsync(process.execPath, ['--check', syntaxCheckPath], { timeout: 10000 });
    } finally {
      await fs.unlink(syntaxCheckPath).catch(() => {});
    }
    steps.push({
      id: 'syntax_check',
      label: 'Module syntax verification (node --check)',
      status: 'PASSED',
      durationMs: Date.now() - syntaxStart
    });

    // Step 2: Re-parse and verify invariants
    const invStart = Date.now();
    const { sourceText, block, catalog } = await readCatalogFromDisk();
    const validation = validateCatalogPayload(catalog);
    if (!validation.valid) {
      throw Object.assign(new Error(`RBAC catalog invariants failed: ${validation.errors.join(' ')}`), {
        code: 'RBAC_INVARIANT_FAILED',
        statusCode: 422,
        details: validation.errors
      });
    }
    const conflicts = detectPrivilegeConflicts(catalog);
    steps.push({
      id: 'invariant_check',
      label: 'Policy schema & lockout invariant check',
      status: 'PASSED',
      durationMs: Date.now() - invStart,
      detail: `${Object.keys(catalog.rolePermissions).length} roles, ${catalog.permissions.length} permissions, ${conflicts.length} conflict warning(s)`
    });

    // Step 3: Live in-memory hot-reload
    const hotStart = Date.now();
    if (isLiveCatalog) {
      applyCatalogSnapshot(catalog);
    }
    steps.push({
      id: 'memory_hot_reload',
      label: 'In-memory authorization catalog hot-reload',
      status: isLiveCatalog ? 'PASSED' : 'SKIPPED',
      durationMs: Date.now() - hotStart
    });

    // Step 4: MongoDB catalog sync & permissionVersion invalidation
    const dbStart = Date.now();
    const dbSyncResult = await syncCatalogToDatabase({ deactivateMissing: true });
    const sessionBump = bumpAllSessions ? await bumpModifiedUsersPermissionVersion([]) : { updatedUsers: 0 };
    steps.push({
      id: 'database_sync',
      label: 'MongoDB Feature/Permission/Role sync & session version bump',
      status: dbSyncResult.connected ? 'PASSED' : 'SKIPPED_OFFLINE',
      durationMs: Date.now() - dbStart,
      detail: dbSyncResult.connected
        ? `Synced ${dbSyncResult.rolePermissionsActivated} active bindings, disabled ${dbSyncResult.rolePermissionsDisabled}, bumped ${sessionBump.updatedUsers} user session(s).`
        : 'MongoDB offline; in-memory catalog active.'
    });

    // Step 5: Generate & validate deployment bundle using DevOps deployment kit
    const artStart = Date.now();
    const normalizedEnv = ['development', 'staging', 'production'].includes(environment) ? environment : 'staging';
    const generated = generateDeploymentFiles({
      serviceName: 'admin-control-plane',
      runtime: 'node',
      provider: 'kubernetes',
      environment: normalizedEnv,
      strategy: 'rolling',
      port: 3000,
      replicas: normalizedEnv === 'production' ? 2 : 1
    });
    const artifactCheck = validateGeneratedArtifact(generated.files);
    if (!artifactCheck.valid) {
      throw Object.assign(new Error(`Deployment bundle failed policy validation: ${artifactCheck.errors.join(' ')}`), {
        code: 'DEPLOYMENT_ARTIFACT_INVALID',
        statusCode: 422
      });
    }
    steps.push({
      id: 'artifact_validation',
      label: 'Control-plane deployment manifest & policy validation',
      status: 'PASSED',
      durationMs: Date.now() - artStart,
      detail: `Bundle digest ${generated.digest.slice(0, 12)} (${Object.keys(generated.files).length} manifests)`
    });

    // Step 6: Trigger configured remote deploy hook if present
    const hookStart = Date.now();
    const rawHook = process.env.ADMIN_RBAC_DEPLOY_HOOK_URL || process.env.RENDER_DEPLOY_HOOK_URL || '';
    let hookOutcome = { triggered: false, mode: 'HOT_RELOAD_LOCAL', httpStatus: null, message: 'No remote deploy hook URL configured; live runtime hot-reload and DB sync applied.' };
    if (String(rawHook).trim()) {
      const hookUrl = validateDeployHookUrl(rawHook);
      const response = await fetch(hookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          deploymentId,
          trigger: 'admin-code-level-rbac',
          actor: String(actor),
          changeReference: String(changeReference || 'MANUAL-REDEPLOY'),
          policyDigest: sha256(block.blockText),
          fileDigest: sha256(sourceText),
          environment: normalizedEnv
        }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        throw Object.assign(new Error(`Remote deploy hook responded with HTTP ${response.status}.`), {
          code: 'REMOTE_DEPLOY_HOOK_FAILED',
          statusCode: 502
        });
      }
      hookOutcome = {
        triggered: true,
        mode: 'REMOTE_DEPLOY_TRIGGERED',
        httpStatus: response.status,
        message: `Remote deploy hook accepted rollout (HTTP ${response.status}).`
      };
    }
    steps.push({
      id: 'remote_deploy_trigger',
      label: 'Remote service deploy hook dispatch',
      status: hookOutcome.triggered ? 'PASSED' : 'LOCAL_ONLY',
      durationMs: Date.now() - hookStart,
      detail: hookOutcome.message
    });

    return {
      success: true,
      deploymentId,
      deployedAt: new Date().toISOString(),
      environment: normalizedEnv,
      policyDigest: sha256(block.blockText),
      fileDigest: sha256(sourceText),
      artifactDigest: generated.digest,
      artifactFiles: Object.keys(generated.files),
      conflicts,
      databaseSync: dbSyncResult,
      sessionBump,
      hookOutcome,
      steps
    };
  }

  async function rollbackCodeRbacSnapshot({
    snapshotId,
    actor = 'unknown-super-admin',
    confirmation = ''
  } = {}) {
    if (confirmation !== 'ROLLBACK CODE RBAC') {
      throw Object.assign(
        new Error('Type ROLLBACK CODE RBAC to confirm restoring the previous code snapshot.'),
        { code: 'CONFIRMATION_REQUIRED', statusCode: 400 }
      );
    }
    const safeId = String(snapshotId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeId) {
      throw Object.assign(new Error('snapshotId is required for rollback.'), {
        code: 'SNAPSHOT_ID_REQUIRED',
        statusCode: 400
      });
    }

    const snapPath = path.join(snapshotDir, `${safeId}.json`);
    let snapshot;
    try {
      snapshot = JSON.parse(await fs.readFile(snapPath, 'utf8'));
    } catch {
      throw Object.assign(new Error('Requested RBAC snapshot was not found.'), {
        code: 'SNAPSHOT_NOT_FOUND',
        statusCode: 404
      });
    }

    const restoredCatalog = evaluateDeclarativeBlock(snapshot.previousBlock);
    const validation = validateCatalogPayload(restoredCatalog);
    if (!validation.valid) {
      throw Object.assign(new Error(`Snapshot is invalid: ${validation.errors.join(' ')}`), {
        code: 'SNAPSHOT_INVALID',
        statusCode: 422
      });
    }

    const { block: currentBlock } = await readCatalogFromDisk();
    const rollbackSnapshotId = `rbac-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
    await writeSnapshot({
      snapshotId: rollbackSnapshotId,
      action: 'ROLLBACK',
      createdAt: new Date().toISOString(),
      actor: String(actor),
      changeReference: `ROLLBACK:${safeId}`,
      previousDigest: sha256(currentBlock.blockText),
      nextDigest: sha256(snapshot.previousBlock),
      previousBlock: currentBlock.blockText,
      summary: { restoredFrom: safeId }
    });

    const updatedSource = await writeCatalogBlockToDisk(snapshot.previousBlock);
    if (isLiveCatalog) {
      applyCatalogSnapshot(validation.catalog);
    }
    const dbSyncResult = await syncCatalogToDatabase({ deactivateMissing: true });
    const sessionBump = await bumpModifiedUsersPermissionVersion([]);

    return {
      success: true,
      restoredSnapshotId: safeId,
      rollbackSnapshotId,
      policyDigest: sha256(snapshot.previousBlock),
      fileDigest: sha256(updatedSource),
      hotReloaded: isLiveCatalog,
      databaseSync: dbSyncResult,
      sessionBump,
      catalog: validation.catalog
    };
  }

  return {
    readCodeRbacState,
    previewCodeRbacDiff,
    modifyCodeRbacCatalog,
    redeployCodeRbac,
    rollbackCodeRbacSnapshot,
    listSnapshots
  };
}

export const codeLevelRbacService = createCodeLevelRbacService();
