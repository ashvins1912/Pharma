import mongoose from 'mongoose';

const riderSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    mobile: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    photoUrl: {
        type: String,
        default: null
    },
    status: {
        type: String,
        enum: ['Available', 'Busy', 'Off-duty'],
        default: 'Available',
        index: true
    },
    enabled: {
        type: Boolean,
        default: true,
        index: true
    },
    disabledAction: {
        type: String,
        enum: ['Suspended', 'Removed', null],
        default: null
    },
    disabledReason: {
        type: String,
        trim: true,
        default: null
    },
    disabledAt: {
        type: Date,
        default: null
    },
    vehicleType: {
        type: String,
        enum: ['Bike', 'Scooter', 'EV Bike', 'Cycle'],
        default: 'Bike'
    },
    currentLocation: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: true,
            default: [77.5946, 12.9716] // Default central hub (e.g. Bangalore / Pharmacy Hub)
        }
    },
    activeOrderIds: {
        type: [String],
        default: []
    },
    totalDeliveries: {
        type: Number,
        default: 0
    },
    rating: {
        type: Number,
        default: 4.9
    }
}, { timestamps: true, collection: 'riders' });

// 2dsphere index for ultra-fast geospatial nearest rider queries
riderSchema.index({ currentLocation: '2dsphere' });
riderSchema.index({ status: 1, 'currentLocation.coordinates': 1 });

const Rider = mongoose.models.Rider || mongoose.model('Rider', riderSchema);
export default Rider;
