/**
 * Abstract Port: IRiderRepository
 * Defines contract for rider data access decoupled from concrete database drivers
 */
export class IRiderRepository {
    /**
     * @param {string} id
     * @returns {Promise<import('../domain/entities/Rider.js').Rider | null>}
     */
    async findById(id) {
        throw new Error('Method IRiderRepository.findById() must be implemented.');
    }

    /**
     * @param {string} mobile
     * @returns {Promise<import('../domain/entities/Rider.js').Rider | null>}
     */
    async findByMobile(mobile) {
        throw new Error('Method IRiderRepository.findByMobile() must be implemented.');
    }

    /**
     * @param {object} filter
     * @returns {Promise<import('../domain/entities/Rider.js').Rider[]>}
     */
    async findAll(filter = {}) {
        throw new Error('Method IRiderRepository.findAll() must be implemented.');
    }

    /**
     * @param {import('../domain/entities/Rider.js').Rider} rider
     * @returns {Promise<import('../domain/entities/Rider.js').Rider>}
     */
    async create(rider) {
        throw new Error('Method IRiderRepository.create() must be implemented.');
    }

    /**
     * @param {string} id
     * @param {object} updateData
     * @returns {Promise<import('../domain/entities/Rider.js').Rider | null>}
     */
    async update(id, updateData) {
        throw new Error('Method IRiderRepository.update() must be implemented.');
    }

    /**
     * Find nearest available riders around coordinates using GeoJSON
     * @param {[number, number]} coordinates [longitude, latitude]
     * @param {number} maxDistanceInMeters
     * @param {number} limit
     * @returns {Promise<Array<{ rider: import('../domain/entities/Rider.js').Rider, distanceInMeters: number }>>}
     */
    async findAvailableNearby(coordinates, maxDistanceInMeters = 15000, limit = 5) {
        throw new Error('Method IRiderRepository.findAvailableNearby() must be implemented.');
    }
}
