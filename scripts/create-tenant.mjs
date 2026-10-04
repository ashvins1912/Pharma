import 'dotenv/config';
import { tenantService } from '../backend/services/tenant-service/TenantService.js';
import { connectDB } from '../backend/config/db.js';

const name = process.argv[2];
const slug = process.argv[3];
const contactEmail = process.argv[4] || '';

if (!name || !name.trim()) {
    console.log('Usage: node scripts/create-tenant.mjs "<Pharmacy Name>" [slug] [contactEmail]');
    process.exit(1);
}

await connectDB({ silent: true }).catch(() => {});

try {
    const tenant = await tenantService.createTenant({
        name: name.trim(),
        slug: slug ? slug.trim() : undefined,
        contactEmail: contactEmail ? contactEmail.trim().toLowerCase() : undefined,
        status: 'ACTIVE'
    });

    console.log('✅ Tenant created successfully:');
    console.log(JSON.stringify(tenant, null, 2));
    process.exit(0);
} catch (err) {
    console.error('❌ Failed to create tenant:', err.message);
    process.exit(1);
}
