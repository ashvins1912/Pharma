import { getIsConnected } from '../../config/db.js';
import { ServiceContainerBuilder } from '@pharma/service-kernel';
import { MongooseRiderRepository } from './infrastructure/repositories/MongooseRiderRepository.js';
import { InMemoryRiderRepository } from './infrastructure/repositories/InMemoryRiderRepository.js';
import { MongooseOrderRepository } from './infrastructure/repositories/MongooseOrderRepository.js';
import { InMemoryOrderRepository } from './infrastructure/repositories/InMemoryOrderRepository.js';

import { SupabaseStorageDriver } from './infrastructure/storage/SupabaseStorageDriver.js';
import { LocalStorageDriver } from './infrastructure/storage/LocalStorageDriver.js';

import { OrderClubbingStrategy } from './strategies/OrderClubbingStrategy.js';
import { ClosestRiderStrategy } from './strategies/ClosestRiderStrategy.js';
import { DroneDeliveryStrategy } from './strategies/DroneDeliveryStrategy.js';

import { OrderAssignmentEngine } from './services/OrderAssignmentEngine.js';

import { RegisterRiderUseCase } from './use-cases/RegisterRiderUseCase.js';
import { GetRidersUseCase } from './use-cases/GetRidersUseCase.js';
import { UpdateRiderStatusUseCase } from './use-cases/UpdateRiderStatusUseCase.js';
import { UpdateRiderLocationUseCase } from './use-cases/UpdateRiderLocationUseCase.js';
import { ManualAssignOrderUseCase } from './use-cases/ManualAssignOrderUseCase.js';
import { SetRiderEnabledUseCase } from './use-cases/SetRiderEnabledUseCase.js';

/**
 * Composition Root / Dependency Injection Container
 * Instantiates and wires Ports & Adapters into Use Cases and Services.
 */
class DeliveryContainer {
    constructor() {
        this._initialized = false;
        this.riderRepository = null;
        this.orderRepository = null;
        this.storageService = null;
        this.assignmentEngine = null;

        // Use Cases
        this.registerRiderUseCase = null;
        this.getRidersUseCase = null;
        this.updateRiderStatusUseCase = null;
        this.updateRiderLocationUseCase = null;
        this.setRiderEnabledUseCase = null;
        this.manualAssignOrderUseCase = null;

        this.init();
    }

    init() {
        if (this._initialized) return;

        // Composition root: factories select adapters once per container lifecycle.
        // Use cases depend on ports, not on the selected persistence implementation.
        const isMongoLive = getIsConnected();
        const builder = new ServiceContainerBuilder()
            .singleton('riderRepository', () => isMongoLive
                ? new MongooseRiderRepository()
                : new InMemoryRiderRepository())
            .singleton('orderRepository', () => isMongoLive
                ? new MongooseOrderRepository()
                : new InMemoryOrderRepository())
            .singleton('storageService', () => {
                const supabaseDriver = new SupabaseStorageDriver();
                return supabaseDriver.isAvailable() ? supabaseDriver : new LocalStorageDriver();
            })
            .singleton('assignmentEngine', ({ riderRepository, orderRepository }) => {
                const strategies = [
                    new OrderClubbingStrategy({ timeWindowMinutes: 15, maxProximityMeters: 2000 }),
                    new ClosestRiderStrategy({ maxSearchRadiusMeters: 20000 })
                ];
                return new OrderAssignmentEngine({ riderRepository, orderRepository, strategies });
            }, ['riderRepository', 'orderRepository'])
            .singleton('registerRiderUseCase', ({ riderRepository, storageService }) =>
                new RegisterRiderUseCase({ riderRepository, storageService }),
            ['riderRepository', 'storageService'])
            .singleton('getRidersUseCase', ({ riderRepository }) =>
                new GetRidersUseCase({ riderRepository }), ['riderRepository'])
            .singleton('updateRiderStatusUseCase', ({ riderRepository }) =>
                new UpdateRiderStatusUseCase({ riderRepository }), ['riderRepository'])
            .singleton('updateRiderLocationUseCase', ({ riderRepository }) =>
                new UpdateRiderLocationUseCase({ riderRepository }), ['riderRepository'])
            .singleton('setRiderEnabledUseCase', ({ riderRepository }) =>
                new SetRiderEnabledUseCase({ riderRepository }), ['riderRepository'])
            .singleton('manualAssignOrderUseCase', ({ riderRepository, orderRepository }) =>
                new ManualAssignOrderUseCase({ riderRepository, orderRepository }),
            ['riderRepository', 'orderRepository']);

        this.container = builder.build();
        Object.assign(this, this.container.resolveAll([
            'riderRepository',
            'orderRepository',
            'storageService',
            'assignmentEngine',
            'registerRiderUseCase',
            'getRidersUseCase',
            'updateRiderStatusUseCase',
            'updateRiderLocationUseCase',
            'setRiderEnabledUseCase',
            'manualAssignOrderUseCase'
        ]));
        this._initialized = true;
    }

    // Refresh bindings when database connects
    refreshDataLayer() {
        if (getIsConnected() && !(this.riderRepository instanceof MongooseRiderRepository)) {
            console.log('🔄 [DeliveryContainer] Upgrading to Mongoose Repositories after DB connect');
            this.riderRepository = new MongooseRiderRepository();
            this.orderRepository = new MongooseOrderRepository();
            this._initialized = false;
            this.init();
        }
    }
}

export const deliveryContainer = new DeliveryContainer();
export default deliveryContainer;
