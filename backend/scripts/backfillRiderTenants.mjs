import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, getIsConnected } from '../config/db.js';
import Rider from '../models/Rider.js';
import Order from '../models/Order.js';
import Tenant from '../models/Tenant.js';

const explicitMapping = (() => {
    const raw = process.env.RIDER_TENANT_MAPPING_JSON || '{}';
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
        return parsed;
    } catch (error) {
        throw new Error(`RIDER_TENANT_MAPPING_JSON is invalid: ${error.message}`);
    }
})();

const main = async () => {
    await connectDB();
    if (!getIsConnected()) throw new Error('MongoDB connection is required for rider tenant migration.');

    const legacyRiders = await Rider.find({
        $or: [{ tenantId: null }, { tenantId: { $exists: false } }, { tenantId: '' }]
    }).select('_id mobile name').lean();
    const migrated = [];
    const unresolved = [];

    for (const rider of legacyRiders) {
        const riderId = String(rider._id);
        const assignedTenantIds = (await Order.distinct('tenantId', {
            'rider.riderId': riderId,
            tenantId: { $nin: [null, ''] }
        })).map(String);
        const uniqueAssignedTenants = [...new Set(assignedTenantIds)];
        const mappedTenant = explicitMapping[riderId] ? String(explicitMapping[riderId]) : null;

        if (uniqueAssignedTenants.length > 1) {
            unresolved.push({ riderId, reason: 'Assigned historical orders belong to multiple tenants; resolve order ownership before migration.' });
            continue;
        }
        const tenantId = mappedTenant || uniqueAssignedTenants[0] || null;
        if (!tenantId || (uniqueAssignedTenants.length === 1 && uniqueAssignedTenants[0] !== tenantId)) {
            unresolved.push({ riderId, reason: 'No unambiguous tenant. Add this riderId to RIDER_TENANT_MAPPING_JSON.' });
            continue;
        }
        const tenant = await Tenant.findOne({ _id: tenantId, status: 'ACTIVE' }).select('_id').lean();
        if (!tenant) {
            unresolved.push({ riderId, reason: `Tenant ${tenantId} is missing or inactive.` });
            continue;
        }
        try {
            await Rider.updateOne(
                { _id: rider._id, $or: [{ tenantId: null }, { tenantId: { $exists: false } }, { tenantId: '' }] },
                { $set: { tenantId } }
            );
            migrated.push({ riderId, tenantId });
        } catch (error) {
            unresolved.push({ riderId, reason: error.code === 11000 ? 'Duplicate mobile within tenant; reconcile duplicate rider records.' : error.message });
        }
    }

    console.log(JSON.stringify({
        scanned: legacyRiders.length,
        migrated,
        unresolved,
        note: 'No ambiguous rider or order ownership was guessed. Resolve every unresolved record before enabling tenant dispatch.'
    }, null, 2));
    if (unresolved.length) process.exitCode = 2;
};

main()
    .catch(error => {
        console.error('[RiderTenantMigration] Failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (mongoose.connection.readyState) await mongoose.disconnect();
    });
