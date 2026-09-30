import deliveryContainer from '../container.js';

export const registerRider = async (req, res) => {
    try {
        deliveryContainer.refreshDataLayer();
        const { name, mobile, vehicleType, longitude, latitude } = req.body;

        let coordinates = [77.5946, 12.9716];
        if (longitude !== undefined && latitude !== undefined) {
            coordinates = [Number(longitude), Number(latitude)];
        }

        const rider = await deliveryContainer.registerRiderUseCase.execute({
            name,
            mobile,
            vehicleType,
            coordinates,
            file: req.file
        });

        res.status(201).json({
            message: `Rider ${rider.name} successfully registered and ready for dispatch.`,
            rider: rider.toJSON()
        });
    } catch (error) {
        console.error('Rider registration error:', error);
        res.status(400).json({ message: error.message || 'Failed to onboard rider.' });
    }
};

export const listRiders = async (req, res) => {
    try {
        deliveryContainer.refreshDataLayer();
        const riders = await deliveryContainer.getRidersUseCase.execute(req.query);
        res.json(riders.map(r => r.toJSON()));
    } catch (error) {
        console.error('List riders error:', error);
        res.status(500).json({ message: 'Failed to retrieve riders.' });
    }
};

export const updateRiderStatus = async (req, res) => {
    try {
        deliveryContainer.refreshDataLayer();
        const { status } = req.body;
        const updated = await deliveryContainer.updateRiderStatusUseCase.execute(req.params.riderId, status);
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
        deliveryContainer.refreshDataLayer();
        const { lng, lat } = req.body;
        if (lng === undefined || lat === undefined) {
            return res.status(400).json({ message: 'Both lng and lat coordinates are required.' });
        }
        const updated = await deliveryContainer.updateRiderLocationUseCase.execute(req.params.riderId, lng, lat);
        res.json({
            message: 'Rider GPS coordinates updated.',
            rider: updated.toJSON()
        });
    } catch (error) {
        console.error('Update rider location error:', error);
        res.status(400).json({ message: error.message || 'Failed to update rider location.' });
    }
};
