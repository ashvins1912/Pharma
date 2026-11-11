import deliveryContainer from '../container.js';
import { connectDB, getIsConnected } from '../../../config/db.js';

const getRiderTenantId = req => {
    const role = String(req.user?.role || req.user?.app_metadata?.role || req.context?.role || '').toUpperCase();
    const platform = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
    return (req.user?.tenantId || req.user?.app_metadata?.tenantId || req.context?.tenantId)
        || (platform ? req.body?.tenantId || req.query?.tenantId : null)
        || null;
};

const requireMongoConnection = async (res) => {
    if (getIsConnected() || await connectDB()) return true;
    res.status(503).json({
        message: 'Could not connect to MongoDB to access rider records. Verify MONGO_URI, Atlas Network Access IP allowlisting, and the database user credentials.'
    });
    return false;
};

export const registerRider = async (req, res) => {
    try {
        if (!await requireMongoConnection(res)) return;
        deliveryContainer.refreshDataLayer();
        const { name, mobile, vehicleType, longitude, latitude } = req.body;
        const tenantId = getRiderTenantId(req);
        if (!tenantId) return res.status(403).json({ code: 'TENANT_CONTEXT_REQUIRED', message: 'A pharmacy tenant context is required.' });

        let coordinates = [77.5946, 12.9716];
        if (longitude !== undefined && latitude !== undefined) {
            coordinates = [Number(longitude), Number(latitude)];
        }

        const rider = await deliveryContainer.registerRiderUseCase.execute({
            tenantId,
            branchId: req.user?.branchId || req.user?.app_metadata?.branchId || req.context?.branchId || null,
            name,
            mobile,
            vehicleType,
            coordinates,
            file: req.file
        });

        res.status(201).json({
            message: `Rider ${rider.name} successfully registered or re-enabled and ready for dispatch.`,
            rider: rider.toJSON()
        });
    } catch (error) {
        if (error?.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0] || 'mobile';
            return res.status(409).json({ code: 'RIDER_DUPLICATE', message: field === 'mobile' ? 'This mobile number is already registered to a rider in this pharmacy.' : 'A rider with this identifier already exists.' });
        }
        console.error('Rider registration error:', error);
        res.status(400).json({ message: error.message || 'Failed to onboard rider.' });
    }
};

export const listRiders = async (req, res) => {
    try {
        if (!await requireMongoConnection(res)) return;
        deliveryContainer.refreshDataLayer();
        const tenantId = getRiderTenantId(req);
        if (!tenantId) return res.status(400).json({ code: 'TENANT_CONTEXT_REQUIRED', message: 'Select a pharmacy tenant to list riders.' });
        const riders = await deliveryContainer.getRidersUseCase.execute({
            ...req.query,
            tenantId,
            includeDisabled: req.query.includeDisabled === 'true'
        });
        res.json(riders.map(r => r.toJSON()));
    } catch (error) {
        console.error('List riders error:', error);
        res.status(500).json({ message: 'Failed to retrieve riders.' });
    }
};

export const setRiderEnabled = async (req, res) => {
    try {
        if (!await requireMongoConnection(res)) return;
        deliveryContainer.refreshDataLayer();
        const { enabled, action, remark } = req.body;
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ message: 'Enabled must be a boolean.' });
        }
        if (!enabled && !['Suspended', 'Removed'].includes(action)) {
            return res.status(400).json({ message: 'Action must be Suspended or Removed.' });
        }
        if (!enabled && (typeof remark !== 'string' || !remark.trim())) {
            return res.status(400).json({ message: 'A remark is required to suspend or remove a rider.' });
        }
        if (remark?.length > 500) {
            return res.status(400).json({ message: 'Remark cannot exceed 500 characters.' });
        }

        const updated = await deliveryContainer.setRiderEnabledUseCase.execute(
            req.params.riderId,
            enabled,
            action,
            remark,
            getRiderTenantId(req)
        );
        res.json({
            message: enabled
                ? `Rider ${updated.name} re-enabled.`
                : `Rider ${action.toLowerCase()} with remark saved.`,
            rider: updated.toJSON()
        });
    } catch (error) {
        console.error('Set rider enabled error:', error);
        res.status(400).json({ message: error.message || 'Could not update rider availability.' });
    }
};

export const updateRiderStatus = async (req, res) => {
    try {
        if (!await requireMongoConnection(res)) return;
        deliveryContainer.refreshDataLayer();
        const { status } = req.body;
        const updated = await deliveryContainer.updateRiderStatusUseCase.execute(req.params.riderId, status, getRiderTenantId(req));
        res.json({
            message: `Rider status updated to ${status}.`,
            rider: updated.toJSON()
        });
    } catch (error) {
        console.error('Update rider status error:', error);
        res.status(400).json({ message: error.message || 'Failed to update rider status.' });
    }
};

export const updateRiderLocation = async (req, res) => {
    try {
        if (!await requireMongoConnection(res)) return;
        deliveryContainer.refreshDataLayer();
        const { lng, lat } = req.body;
        if (lng === undefined || lat === undefined) {
            return res.status(400).json({ message: 'Both lng and lat coordinates are required.' });
        }
        const updated = await deliveryContainer.updateRiderLocationUseCase.execute(req.params.riderId, lng, lat, getRiderTenantId(req));
        res.json({
            message: 'Rider GPS coordinates updated.',
            rider: updated.toJSON()
        });
    } catch (error) {
        console.error('Update rider location error:', error);
        res.status(400).json({ message: error.message || 'Failed to update rider location.' });
    }
};
