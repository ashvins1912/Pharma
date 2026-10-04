import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.argv[2] || 'ashvinsingh25@gmail.com').trim().toLowerCase();

let requestedRole = (process.argv[3] || 'SUPER_ADMIN').trim().toUpperCase();
if (requestedRole === 'ADMIN' || requestedRole === 'PLATFORM_SUPER_ADMIN') {
    requestedRole = 'SUPER_ADMIN';
}

let requestedTenantId = process.argv[4] ? process.argv[4].trim() : null;

// Validate role and tenantId logic
const VALID_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN', 'PHARMACY_STAFF', 'CUSTOMER', 'RIDER'];
if (!VALID_ROLES.includes(requestedRole)) {
    console.error(`Invalid role: ${requestedRole}. Allowed roles: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
}

if (requestedRole === 'SUPER_ADMIN') {
    // Super Admin is strictly platform-scoped with NO tenant scope
    requestedTenantId = null;
} else if ((requestedRole === 'TENANT_ADMIN' || requestedRole === 'PHARMACY_STAFF') && !requestedTenantId) {
    requestedTenantId = 'tenant-ashvin-main';
    console.log(`No tenantId specified for ${requestedRole}, defaulting to "${requestedTenantId}".`);
}

if (!supabaseUrl || !serviceRoleKey) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the local server environment.');
    process.exit(1);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Provide a valid account email address.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

let page = 1;
let targetUser = null;
while (!targetUser) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not search Supabase users: ${error.message}`);
    targetUser = data.users.find(user => user.email?.toLowerCase() === email) || null;
    if (targetUser || data.users.length < 1000) break;
    page += 1;
}

if (!targetUser) {
    console.error(`No Supabase Auth account found for ${email}. Sign in once with that account, then retry.`);
    process.exit(1);
}

const updatedAppMetadata = {
    ...targetUser.app_metadata,
    role: requestedRole,
    tenantId: requestedTenantId
};

const { data, error } = await supabase.auth.admin.updateUserById(targetUser.id, {
    app_metadata: updatedAppMetadata
});

if (error) throw new Error(`Could not grant ${requestedRole} access: ${error.message}`);
if (data.user?.app_metadata?.role !== requestedRole) {
    throw new Error(`Supabase did not confirm the ${requestedRole} role update.`);
}

console.log(`Role ${requestedRole} (tenantId: ${requestedTenantId || 'PLATFORM'}) successfully assigned to ${email}.`);
console.log('User must sign out and sign back in to refresh their Supabase access token.');
