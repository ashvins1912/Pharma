/* API Gateway Profile & Onboarding Routes (/api/v1/profile/*)
 */
import express from 'express';
import { authService, calculateAge, isValidDOB, isValidMobile } from '../../services/identity-service/AuthService.js';
import { authenticateUser, requirePlatformSuperAdmin } from '../../middleware/auth.js';
import UserProfile from '../../models/UserProfile.js';
import { isPlatformSuperAdmin } from '../../shared/contracts/index.js';
import { isKnownPermission } from '../../authorization/AuthorizationCatalogService.js';
import { sendSuccess, sendError } from '../../shared/responses.js';
import { setSessionCookies } from '../../security/sessionCookie.js';



const router = express.Router();

/**
 * PUT /api/v1/profile/me
 * Update editable profile fields for the authenticated user.
 */
router.put('/me', authenticateUser, async (req, res) => {
    const userId = req.user?.id || req.user?.sub || req.user?.userId;
    if (!userId) return sendError(res, { code: 'UNAUTHORIZED', message: 'Authentication required.', statusCode: 401, req });

    const { firstName, lastName, mobileNumber, mobile, gender, dateOfBirth } = req.body || {};
    try {
        const result = await authService.updateProfile({
            userId,
            firstName,
            lastName,
            mobileNumber: mobileNumber || mobile,
            gender,
            dateOfBirth
        });
        if (result.accessToken) setSessionCookies(res, { accessToken: result.accessToken });
        return sendSuccess(res, { data: result, message: 'Profile updated successfully.', statusCode: 200, req });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'PROFILE_UPDATE_FAILED',
            message: err.message || 'Could not update profile.',
            statusCode: err.status || 400,
            req
        });
    }
});

/**
 * PUT /api/v1/profile/onboarding
 * Completes profile after Google OAuth or initial incomplete state
 */
router.put('/onboarding', authenticateUser, async (req, res) => {
    const userId = req.user?.id || req.user?.sub || req.user?.userId;
    if (!userId) {
        return sendError(res, {
            code: 'UNAUTHORIZED',
            message: 'You must be signed in to complete profile onboarding.',
            statusCode: 401,
            req
        });
    }

    const { firstName, lastName, dateOfBirth, mobileNumber, mobile, gender } = req.body || {};
    const phone = (mobileNumber || mobile || '').trim();

    const validationDetails = [];
    if (!firstName || !firstName.trim()) {
        validationDetails.push({ field: 'firstName', code: 'REQUIRED', message: 'First name is required.' });
    }
    if (gender && !['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'].includes(gender)) {
        validationDetails.push({ field: 'gender', code: 'INVALID_GENDER', message: 'Select a valid gender option.' });
    }
    if (!dateOfBirth) {
        validationDetails.push({ field: 'dateOfBirth', code: 'REQUIRED', message: 'Date of birth is required.' });
    } else if (!isValidDOB(dateOfBirth)) {
        validationDetails.push({ field: 'dateOfBirth', code: 'INVALID_DOB', message: 'Date of birth must be a valid past date.' });
    }
    if (!phone || !isValidMobile(phone)) {
        validationDetails.push({ field: 'mobileNumber', code: 'INVALID_MOBILE', message: 'Valid mobile number with at least 10 digits is required.' });
    }

    if (validationDetails.length > 0) {
        return sendError(res, {
            code: 'VALIDATION_ERROR',
            message: 'Please complete all required fields correctly.',
            details: validationDetails,
            statusCode: 400,
            req
        });
    }

    try {
        const result = await authService.completeProfile({
            userId,
            firstName,
            lastName,
            dateOfBirth,
            mobileNumber: phone,
            gender
        });

        if (result.accessToken) {
            setSessionCookies(res, { accessToken: result.accessToken });
        }

        return sendSuccess(res, {
            data: result,
            message: 'Profile completed successfully.',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'ONBOARDING_ERROR',
            message: err.message || 'Failed to complete profile onboarding.',
            statusCode: err.status || 400,
            req
        });
    }
});

router.get('/access/users', authenticateUser, requirePlatformSuperAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const filter = { role: { $nin: ['customer', 'CUSTOMER'] }, accountStatus: { $nin: ['DELETED', 'SUSPENDED', 'DISABLED'] } };
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [{ name: rx }, { email: rx }, { normalizedEmail: rx }, { userId: rx }, { supabase_user_id: rx }, { role: rx }];
    }
    const users = await UserProfile.find(filter).select('userId supabase_user_id supabaseId name firstName lastName email role roles tenantId branchId permissions accessGrants accessRevokes permissionVersion accountStatus').sort({ updatedAt: -1 }).limit(50).lean();
    return sendSuccess(res, { data: users.map(u => ({ ...u, id: u.userId || u.supabase_user_id || u.supabaseId, effectiveSuperAdmin: isPlatformSuperAdmin(u.role) })), message: 'Platform users retrieved.', statusCode: 200, req });
  } catch (err) {
    return sendError(res, { code: 'ACCESS_USERS_FAILED', message: err.message || 'Could not load platform users.', statusCode: 500, req });
  }
});

router.patch('/access/users/:userId', authenticateUser, requirePlatformSuperAdmin, async (req, res) => {
  try {
    const targetId = String(req.params.userId || '').trim();
    const clean = value => [...new Set((Array.isArray(value) ? value : []).map(v => String(v).trim()).filter(v => isKnownPermission(v) && !v.includes('*')))];
    const target = await UserProfile.findOne({ $or: [{ userId: targetId }, { supabase_user_id: targetId }, { supabaseId: targetId }] });
    if (!target) return sendError(res, { code: 'USER_NOT_FOUND', message: 'Platform user was not found.', statusCode: 404, req });
    if (isPlatformSuperAdmin(target.role)) return sendError(res, { code: 'SUPER_ADMIN_LOCKED', message: 'Super Admin has complete access and cannot have permissions restricted.', statusCode: 409, req });
    target.accessGrants = clean(req.body?.grants);
    target.accessRevokes = clean(req.body?.revokes);
    target.permissionVersion = Number(target.permissionVersion || 1) + 1;
    await target.save();
    return sendSuccess(res, { data: { id: target.userId || target.supabase_user_id || target.supabaseId, name: target.name, email: target.email, role: target.role, permissions: target.permissions || [], accessGrants: target.accessGrants || [], accessRevokes: target.accessRevokes || [], permissionVersion: target.permissionVersion }, message: 'Security assignment updated.', statusCode: 200, req });
  } catch (err) {
    return sendError(res, { code: 'ACCESS_ASSIGNMENT_FAILED', message: err.message || 'Could not update security assignment.', statusCode: 400, req });
  }
});

/**
 * GET /api/v1/profile/me
 */
router.get('/me', authenticateUser, async (req, res) => {
    try {
        const profile = await authService.getUserProfile(req.user, req.context);
        return sendSuccess(res, {
            data: profile,
            message: 'Profile retrieved successfully',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: 'INTERNAL_SERVER_ERROR',
            message: err.message,
            statusCode: 500,
            req
        });
    }
});

export default router;
