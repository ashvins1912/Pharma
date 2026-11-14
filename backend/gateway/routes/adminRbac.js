import express from 'express';
import mongoose from 'mongoose';
import { authenticateUser, requireSuperAdmin } from '../../middleware/auth.js';
import { getIsConnected } from '../../config/db.js';
import { codeLevelRbacService } from '../../authorization/CodeLevelRbacService.js';
import { centralRbacService } from '../../authorization/CentralRbacService.js';

const rbacAuditSchema = new mongoose.Schema({
  actor: { type: String, required: true, immutable: true },
  event: { type: String, required: true, immutable: true },
  outcome: { type: String, required: true, immutable: true },
  changeReference: { type: String, default: null, immutable: true },
  snapshotId: { type: String, default: null, immutable: true },
  deploymentId: { type: String, default: null, immutable: true },
  policyDigest: { type: String, default: null, immutable: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
  requestId: { type: String, default: null, immutable: true },
  occurredAt: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false, strict: true });
rbacAuditSchema.index({ occurredAt: -1 });

const CodeRbacAudit = mongoose.models.CodeRbacAudit || mongoose.model('CodeRbacAudit', rbacAuditSchema, 'code_rbac_audit');

const actorOf = req => String(req.user?.email || req.user?.sub || req.user?.id || 'unknown-super-admin');
const requestIdOf = req => req.context?.requestId || req.gatewayRequestId || req.get('x-request-id') || null;
const ipOf = req => req.ip || req.socket?.remoteAddress || null;

async function recordAudit(req, { event, outcome, changeReference = null, snapshotId = null, deploymentId = null, policyDigest = null, details = {} }) {
  if (!getIsConnected() || mongoose.connection?.readyState !== 1) return null;
  try {
    return await CodeRbacAudit.create({
      actor: actorOf(req),
      event,
      outcome,
      changeReference,
      snapshotId,
      deploymentId,
      policyDigest,
      details,
      requestId: requestIdOf(req)
    });
  } catch (err) {
    console.warn('[AdminRbac] Audit write skipped:', err.message);
    return null;
  }
}

function enforcePlatformAdmin(req, res, next) {
  if (req.authz && req.authz.scope && req.authz.scope !== 'PLATFORM') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Platform-scoped Super Administrator privileges are required for code-level RBAC.'
      }
    });
  }
  return next();
}

export function createAdminRbacRouter(
  rbacService = codeLevelRbacService,
  centralRbac = centralRbacService
) {
  const router = express.Router();
  router.use(authenticateUser);

  // =========================================================================
  // 1. Centralized Role, Permission, User Assignment & Sensitive Activity Logs
  // Protected by centralRbac.requireDisplayPermission / requireModifyPermission
  // =========================================================================

  router.get(
    '/governance/roles',
    centralRbac.requireDisplayPermission('users.read', { resourceType: 'role_policy' }),
    async (_req, res) => {
      try {
        const data = centralRbac.getRoleDefinitions();
        res.set('Cache-Control', 'private, no-store');
        return res.json({ success: true, data });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          code: error.code || 'RBAC_ROLES_LOAD_FAILED',
          message: error.message || 'Could not load RBAC role definitions.'
        });
      }
    }
  );

  router.get(
    '/governance/users',
    centralRbac.requireDisplayPermission('users.read', { resourceType: 'user_role' }),
    async (req, res) => {
      try {
        const users = await centralRbac.listUsers({
          search: req.query.search || '',
          tier: req.query.tier || 'ALL',
          actorContext: req.authz || null
        });
        res.set('Cache-Control', 'private, no-store');
        return res.json({ success: true, data: { users, count: users.length } });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          code: error.code || 'RBAC_USERS_LOAD_FAILED',
          message: error.message || 'Could not load platform users.'
        });
      }
    }
  );

  router.patch(
    '/governance/users/:userId/role',
    centralRbac.requireModifyPermission('users.manage', { resourceType: 'user_role' }),
    async (req, res) => {
      try {
        const { role, grants, revokes, reason } = req.body || {};
        const result = await centralRbac.assignUserRole({
          actor: { ...req.user, ...req.authz },
          targetUserId: req.params.userId,
          role,
          grants,
          revokes,
          reason,
          requestMeta: {
            ipAddress: ipOf(req),
            requestId: requestIdOf(req)
          }
        });
        res.set('Cache-Control', 'private, no-store');
        return res.json({
          success: true,
          data: result,
          message: `Updated role and permission assignment for ${result.user.email || result.user.id}.`
        });
      } catch (error) {
        await centralRbac.logSensitiveAction({
          actor: { ...req.user, ...req.authz },
          action: 'ROLE_ASSIGNMENT_FAILED',
          operation: 'modify',
          resourceType: 'user_role',
          targetId: req.params.userId,
          outcome: 'FAILED',
          reason: error.message || 'Role assignment failed',
          ipAddress: ipOf(req),
          requestId: requestIdOf(req)
        });
        return res.status(error.statusCode || 400).json({
          success: false,
          code: error.code || 'ROLE_ASSIGNMENT_FAILED',
          message: error.message || 'Could not assign role or permissions.'
        });
      }
    }
  );

  router.put(
    '/governance/roles/:roleCode/permissions',
    centralRbac.requireModifyPermission('users.manage', { resourceType: 'role_policy' }),
    async (req, res) => {
      try {
        const { permissions, reason } = req.body || {};
        const result = await centralRbac.updateRolePermissions({
          actor: { ...req.user, ...req.authz },
          roleCode: req.params.roleCode,
          permissions,
          reason,
          requestMeta: {
            ipAddress: ipOf(req),
            requestId: requestIdOf(req)
          }
        });
        res.set('Cache-Control', 'private, no-store');
        return res.json({
          success: true,
          data: result,
          message: `Permissions updated for role ${result.role}.`
        });
      } catch (error) {
        await centralRbac.logSensitiveAction({
          actor: { ...req.user, ...req.authz },
          action: 'ROLE_PERMISSIONS_UPDATE_FAILED',
          operation: 'modify',
          resourceType: 'role_policy',
          targetId: req.params.roleCode,
          outcome: 'FAILED',
          reason: error.message || 'Role permission update failed',
          ipAddress: ipOf(req),
          requestId: requestIdOf(req)
        });
        return res.status(error.statusCode || 400).json({
          success: false,
          code: error.code || 'ROLE_PERMISSIONS_UPDATE_FAILED',
          message: error.message || 'Could not update role permissions.'
        });
      }
    }
  );

  router.get(
    '/governance/activity-logs',
    centralRbac.requireDisplayPermission('users.read', { resourceType: 'activity_log' }),
    async (req, res) => {
      try {
        const logs = await centralRbac.listActivityLogs({
          limit: req.query.limit || 60,
          action: req.query.action || '',
          outcome: req.query.outcome || '',
          search: req.query.search || ''
        });
        res.set('Cache-Control', 'private, no-store');
        return res.json({ success: true, data: { logs, count: logs.length } });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          code: error.code || 'ACTIVITY_LOGS_LOAD_FAILED',
          message: error.message || 'Could not load sensitive activity logs.'
        });
      }
    }
  );

  // =========================================================================
  // 2. Code-Level RBAC Catalog Read, Diff Preview, Modify, Redeploy & Rollback
  // Strictly platform Super Admin + centralized display/modify middleware
  // =========================================================================

  router.get(
    '/code-catalog',
    requireSuperAdmin,
    enforcePlatformAdmin,
    centralRbac.requireDisplayPermission('rbac.display', { resourceType: 'code_rbac' }),
    async (_req, res) => {
      try {
        const state = await rbacService.readCodeRbacState();
        res.set('Cache-Control', 'private, no-store');
        return res.json({ success: true, data: state });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          code: error.code || 'RBAC_READ_FAILED',
          message: error.message || 'Could not read code-level RBAC catalog.'
        });
      }
    }
  );

  router.get(
    '/history',
    requireSuperAdmin,
    enforcePlatformAdmin,
    centralRbac.requireDisplayPermission('rbac.display', { resourceType: 'code_rbac' }),
    async (_req, res) => {
      try {
        const snapshots = await rbacService.listSnapshots(30);
        let audits = [];
        if (getIsConnected() && mongoose.connection?.readyState === 1) {
          audits = await CodeRbacAudit.find({}).sort({ occurredAt: -1 }).limit(50).lean();
        }
        res.set('Cache-Control', 'private, no-store');
        return res.json({ success: true, data: { snapshots, audits } });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          success: false,
          code: error.code || 'RBAC_HISTORY_FAILED',
          message: error.message || 'Could not load RBAC history.'
        });
      }
    }
  );

  router.post(
    '/preview-diff',
    requireSuperAdmin,
    enforcePlatformAdmin,
    centralRbac.requireDisplayPermission('rbac.display', { resourceType: 'code_rbac' }),
    async (req, res) => {
      try {
        const proposed = req.body?.catalog || req.body || {};
        const preview = await rbacService.previewCodeRbacDiff(proposed);
        res.set('Cache-Control', 'private, no-store');
        return res.status(preview.valid ? 200 : 422).json({
          success: preview.valid,
          data: preview,
          message: preview.valid ? 'Code-level RBAC diff validated.' : 'Validation failed.'
        });
      } catch (error) {
        return res.status(error.statusCode || 400).json({
          success: false,
          code: error.code || 'RBAC_DIFF_FAILED',
          message: error.message || 'Could not preview code-level RBAC diff.'
        });
      }
    }
  );

  router.put(
    '/code-catalog',
    requireSuperAdmin,
    enforcePlatformAdmin,
    centralRbac.requireModifyPermission('rbac.modify', { resourceType: 'code_rbac' }),
    async (req, res) => {
      try {
        const {
          catalog,
          changeReference,
          confirmation,
          syncDatabase = true,
          allowConflicts = false
        } = req.body || {};
        const result = await rbacService.modifyCodeRbacCatalog({
          catalog,
          actor: actorOf(req),
          changeReference,
          confirmation,
          syncDatabase: Boolean(syncDatabase),
          allowConflicts: Boolean(allowConflicts)
        });
        await recordAudit(req, {
          event: 'CODE_RBAC_MODIFIED',
          outcome: 'SUCCESS',
          changeReference,
          snapshotId: result.snapshotId,
          policyDigest: result.nextDigest,
          details: {
            modifiedRoles: result.diff?.roleChanges?.map(r => r.role) || [],
            addedFeatures: result.diff?.addedFeatures || [],
            removedFeatures: result.diff?.removedFeatures || [],
            conflictCount: result.conflicts?.length || 0,
            hotReloaded: result.hotReloaded,
            databaseSynced: Boolean(result.databaseSync?.synced)
          }
        });
        await centralRbac.logSensitiveAction({
          actor: { ...req.user, ...req.authz },
          action: 'CODE_RBAC_MODIFIED',
          operation: 'modify',
          resourceType: 'code_rbac',
          targetId: result.snapshotId,
          targetLabel: 'AuthorizationCatalogService.js',
          outcome: 'ALLOWED',
          reason: changeReference,
          before: { policyDigest: result.previousDigest },
          after: { policyDigest: result.nextDigest, modifiedRoles: result.diff?.roleChanges?.map(r => r.role) || [] },
          ipAddress: ipOf(req),
          requestId: requestIdOf(req)
        });
        res.set('Cache-Control', 'private, no-store');
        return res.json({
          success: true,
          data: result,
          message: 'Code-level RBAC policy updated and hot-reloaded.'
        });
      } catch (error) {
        await recordAudit(req, {
          event: 'CODE_RBAC_MODIFY_FAILED',
          outcome: 'FAILED',
          changeReference: req.body?.changeReference || null,
          details: { errorCode: error.code || 'RBAC_MODIFY_FAILED', message: error.message }
        });
        return res.status(error.statusCode || 400).json({
          success: false,
          code: error.code || 'RBAC_MODIFY_FAILED',
          message: error.message || 'Could not modify code-level RBAC catalog.',
          details: error.details || []
        });
      }
    }
  );

  router.post(
    '/redeploy',
    requireSuperAdmin,
    enforcePlatformAdmin,
    centralRbac.requireModifyPermission('rbac.modify', { resourceType: 'code_rbac' }),
    async (req, res) => {
      try {
        const {
          changeReference = 'MANUAL-REDEPLOY',
          confirmation,
          environment,
          bumpAllSessions = true
        } = req.body || {};
        const result = await rbacService.redeployCodeRbac({
          actor: actorOf(req),
          changeReference,
          confirmation,
          environment,
          bumpAllSessions: Boolean(bumpAllSessions)
        });
        await recordAudit(req, {
          event: 'CODE_RBAC_REDEPLOYED',
          outcome: 'SUCCESS',
          changeReference,
          deploymentId: result.deploymentId,
          policyDigest: result.policyDigest,
          details: {
            environment: result.environment,
            artifactDigest: result.artifactDigest,
            hookTriggered: Boolean(result.hookOutcome?.triggered),
            mode: result.hookOutcome?.mode || 'HOT_RELOAD_LOCAL',
            updatedUsers: result.sessionBump?.updatedUsers || 0
          }
        });
        await centralRbac.logSensitiveAction({
          actor: { ...req.user, ...req.authz },
          action: 'CODE_RBAC_REDEPLOYED',
          operation: 'modify',
          resourceType: 'code_rbac',
          targetId: result.deploymentId,
          targetLabel: result.environment,
          outcome: 'ALLOWED',
          reason: changeReference,
          after: { policyDigest: result.policyDigest, mode: result.hookOutcome?.mode },
          ipAddress: ipOf(req),
          requestId: requestIdOf(req)
        });
        res.set('Cache-Control', 'private, no-store');
        return res.json({
          success: true,
          data: result,
          message: result.hookOutcome?.triggered
            ? 'Code-level RBAC verified, synced, and remote redeploy triggered.'
            : 'Code-level RBAC verified, hot-reloaded, and synced across the control plane.'
        });
      } catch (error) {
        await recordAudit(req, {
          event: 'CODE_RBAC_REDEPLOY_FAILED',
          outcome: 'FAILED',
          changeReference: req.body?.changeReference || null,
          details: { errorCode: error.code || 'RBAC_REDEPLOY_FAILED', message: error.message }
        });
        return res.status(error.statusCode || 400).json({
          success: false,
          code: error.code || 'RBAC_REDEPLOY_FAILED',
          message: error.message || 'Code-level RBAC redeploy failed.',
          details: error.details || []
        });
      }
    }
  );

  router.post(
    '/rollback',
    requireSuperAdmin,
    enforcePlatformAdmin,
    centralRbac.requireModifyPermission('rbac.modify', { resourceType: 'code_rbac' }),
    async (req, res) => {
      try {
        const { snapshotId, confirmation } = req.body || {};
        const result = await rbacService.rollbackCodeRbacSnapshot({
          snapshotId,
          actor: actorOf(req),
          confirmation
        });
        await recordAudit(req, {
          event: 'CODE_RBAC_ROLLED_BACK',
          outcome: 'SUCCESS',
          changeReference: `ROLLBACK:${snapshotId}`,
          snapshotId: result.rollbackSnapshotId,
          policyDigest: result.policyDigest,
          details: {
            restoredSnapshotId: snapshotId,
            hotReloaded: result.hotReloaded,
            databaseSynced: Boolean(result.databaseSync?.synced)
          }
        });
        await centralRbac.logSensitiveAction({
          actor: { ...req.user, ...req.authz },
          action: 'CODE_RBAC_ROLLED_BACK',
          operation: 'modify',
          resourceType: 'code_rbac',
          targetId: snapshotId,
          targetLabel: 'AuthorizationCatalogService.js',
          outcome: 'ALLOWED',
          reason: `Rollback to ${snapshotId}`,
          after: { policyDigest: result.policyDigest },
          ipAddress: ipOf(req),
          requestId: requestIdOf(req)
        });
        res.set('Cache-Control', 'private, no-store');
        return res.json({
          success: true,
          data: result,
          message: `Rolled back code-level RBAC to snapshot ${snapshotId}.`
        });
      } catch (error) {
        await recordAudit(req, {
          event: 'CODE_RBAC_ROLLBACK_FAILED',
          outcome: 'FAILED',
          snapshotId: req.body?.snapshotId || null,
          details: { errorCode: error.code || 'RBAC_ROLLBACK_FAILED', message: error.message }
        });
        return res.status(error.statusCode || 400).json({
          success: false,
          code: error.code || 'RBAC_ROLLBACK_FAILED',
          message: error.message || 'Could not roll back code-level RBAC snapshot.'
        });
      }
    }
  );

  return router;
}

export default createAdminRbacRouter();
