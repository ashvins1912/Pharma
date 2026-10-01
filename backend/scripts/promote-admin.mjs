import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.argv[2] || 'ashvinsingh25@gmail.com').trim().toLowerCase();

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

const { data, error } = await supabase.auth.admin.updateUserById(targetUser.id, {
    app_metadata: { ...targetUser.app_metadata, role: 'admin' }
});
if (error) throw new Error(`Could not grant admin access: ${error.message}`);
if (data.user?.app_metadata?.role !== 'admin') {
    throw new Error('Supabase did not confirm the admin role update.');
}

console.log(`Admin role assigned to ${email}. Sign out and sign back in to refresh the access token.`);
