import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rawEmails = process.env.SUPER_ADMIN_EMAILS || '';

if (!rawEmails.trim()) {
    console.log('No SUPER_ADMIN_EMAILS configured in environment. Skipping bootstrap.');
    process.exit(0);
}

if (!supabaseUrl || !serviceRoleKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to run super admin bootstrap.');
    process.exit(1);
}

const emails = rawEmails
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

if (emails.length === 0) {
    console.log('No valid email addresses parsed from SUPER_ADMIN_EMAILS.');
    process.exit(0);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

console.log(`[BOOTSTRAP] Checking platform super admin accounts for: ${emails.join(', ')}`);

// Fetch all users to match against emails
let allUsers = [];
let page = 1;
while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
        console.error(`Failed to fetch Supabase users: ${error.message}`);
        process.exit(1);
    }
    allUsers.push(...(data?.users || []));
    if (!data?.users || data.users.length < 1000) break;
    page += 1;
}

let promotedCount = 0;
let unchangedCount = 0;
let missingCount = 0;

for (const email of emails) {
    const user = allUsers.find(u => u.email?.toLowerCase() === email);
    if (!user) {
        console.warn(`[BOOTSTRAP] Notice: Account not found for ${email}. The user must register before promotion.`);
        missingCount += 1;
        continue;
    }

    const currentRole = user.app_metadata?.role;
    const currentTenant = user.app_metadata?.tenantId;

    if (currentRole === 'SUPER_ADMIN' && currentTenant === null) {
        console.log(`[BOOTSTRAP] Verified: ${email} is already configured as SUPER_ADMIN (no-op).`);
        unchangedCount += 1;
        continue;
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
        app_metadata: {
            ...user.app_metadata,
            role: 'SUPER_ADMIN',
            tenantId: null
        }
    });

    if (updateError) {
        console.error(`[BOOTSTRAP] Error updating ${email}: ${updateError.message}`);
    } else {
        console.log(`[BOOTSTRAP] Success: Promoted ${email} to SUPER_ADMIN (platform scope).`);
        promotedCount += 1;
    }
}

console.log(`[BOOTSTRAP SUMMARY] Promoted: ${promotedCount}, Unchanged: ${unchangedCount}, Missing: ${missingCount}`);
process.exit(0);
