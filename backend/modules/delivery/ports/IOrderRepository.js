/**
 * Abstract Port: IOrderRepository
 * Defines contract for order data access decoupled from concrete database drivers
 */
export class IOrderRepository {
    /**
     * @param {string} id
     * @returns {Promise<import('../domain/entities/Order.js').Order | null>}
     */
    async findById(id) {
        throw new Error('Method IOrderRepository.findById() must be implemented.');
    }

    /**
     * @param {object} filter
     * @returns {Promise<import('../domain/entities/Order.js').Order[]>}
     */
    async findAll(filter = {}) {
        throw new Error('Method IOrderRepository.findAll() must be implemented.');
    }

    /**
     * @param {string} id
     * @param {object} updateData
     * @returns {Promise<import('../domain/entities/Order.js').Order | null>}
     */
    async update(id, updateData) {
        throw new Error('Method IOrderRepository.update() must be implemented.');
    }

    /**
     * Find active, assigned orders located near given coordinates (for clubbing)
     * @param {[number, number]} coordinates [longitude, latitude]
     * @param {number} maxDistanceInMeters (e.g. 2000m = 2km)
     * @param {string[]} statuses
     * @returns {Promise<Array<{ order: import('../domain/entities/Order.js').Order, distanceInMeters: number }>>}
     */
    async findActiveOrdersInProximity(coordinates, maxDistanceInMeters = 2000, statuses = ['Ready to Dispatch', 'Dispatched']) {
        throw new Error('Method IOrderRepository.findActiveOrdersInProximity() must be implemented.');
    }
}
