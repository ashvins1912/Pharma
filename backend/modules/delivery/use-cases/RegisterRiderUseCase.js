import { Rider } from '../domain/entities/Rider.js';

/**
 * Use Case: RegisterRiderUseCase
 * Orchestrates rider onboarding:
 * 1. Validates inputs & mobile uniqueness.
 * 2. Uploads profile picture via IStorageService port (Supabase / Local / S3).
 * 3. Instantiates Rider domain entity.
 * 4. Persists via IRiderRepository port.
 */
export class RegisterRiderUseCase {
    /**
     * @param {object} dependencies
     * @param {import('../ports/IRiderRepository.js').IRiderRepository} dependencies.riderRepository
     * @param {import('../ports/IStorageService.js').IStorageService} dependencies.storageService
     */
    constructor({ riderRepository, storageService }) {
        this.riderRepository = riderRepository;
        this.storageService = storageService;
    }

    /**
     * @param {object} command
     * @param {string} command.name
     * @param {string} command.mobile
     * @param {string} [command.vehicleType]
     * @param {number[]} [command.coordinates] - [longitude, latitude]
     * @param {object} [command.file] - Uploaded file from multer
     * @param {Buffer} [command.file.buffer]
     * @param {string} [command.file.originalname]
     * @param {string} [command.file.mimetype]
     * @returns {Promise<Rider>}
     */
    async execute(command) {
        const { name, mobile, vehicleType = 'Bike', coordinates, file } = command;

        if (!name?.trim()) {
            throw new Error('Rider full name is required.');
        }
        if (!mobile?.trim()) {
            throw new Error('Rider mobile number is required.');
        }

        // Validate mobile uniqueness
        const existingRider = await this.riderRepository.findByMobile(mobile);
        if (existingRider) {
            throw new Error(`A rider with mobile number ${mobile} is already registered.`);
        }

        // Handle Photo Upload via Storage Abstraction
        let photoUrl = null;
        if (file && file.buffer) {
            try {
                const uploadResult = await this.storageService.upload({
                    buffer: file.buffer,
                    filename: file.originalname || 'rider-avatar.jpg',
                    mimeType: file.mimetype || 'image/jpeg',
                    bucket: 'rider-photos'
                });
                photoUrl = uploadResult.publicUrl;
            } catch (storageError) {
                console.warn('[RegisterRiderUseCase] Storage driver warning:', storageError.message);
                // Fallback to placeholder avatar if external bucket is offline
                photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0D8ABC&color=fff&size=200`;
            }
        } else {
            photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=4F46E5&color=fff&size=200`;
        }

        // Parse coordinates
        let riderCoords = [77.5946, 12.9716];
        if (Array.isArray(coordinates) && coordinates.length === 2) {
            riderCoords = [Number(coordinates[0]), Number(coordinates[1])];
        }

        // Create domain entity
        const rider = new Rider({
            name,
            mobile,
            photoUrl,
            status: Rider.STATUSES.AVAILABLE,
            vehicleType,
            currentLocation: riderCoords,
            activeOrderIds: [],
            totalDeliveries: 0,
            rating: 5.0
        });

        // Persist through repository port
        return await this.riderRepository.create(rider);
    }
}
