import { getIsConnected } from '../../config/db.js';
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

        // 1. Data Layer Adapter Selection (Repository Pattern)
        const isMongoLive = getIsConnected();
        if (isMongoLive) {
            console.log('📦 [DeliveryContainer] Binding Mongoose Repositories');
            this.riderRepository = new MongooseRiderRepository();
            this.orderRepository = new MongooseOrderRepository();
        } else {
            console.log('📦 [DeliveryContainer] Binding In-Memory Resilient Repositories');
            this.riderRepository = new InMemoryRiderRepository();
            this.orderRepository = new InMemoryOrderRepository();
        }

        // 2. Storage Adapter Selection (Strategy Pattern)
        const supabaseDriver = new SupabaseStorageDriver();
        if (supabaseDriver.isAvailable()) {
            console.log('☁️ [DeliveryContainer] Binding Supabase Storage Driver');
            this.storageService = supabaseDriver;
        } else {
            console.log('💾 [DeliveryContainer] Binding Local/Memory Storage Driver (Supabase credentials unset)');
            this.storageService = new LocalStorageDriver();
        }

        // 3. Automated Assignment Engine Pipeline Configuration (Expandable Strategy Array)
        const defaultStrategies = [
            new OrderClubbingStrategy({ timeWindowMinutes: 15, maxProximityMeters: 2000 }),
            new ClosestRiderStrategy({ maxSearchRadiusMeters: 20000 })
        ];

        this.assignmentEngine = new OrderAssignmentEngine({
            riderRepository: this.riderRepository,
            orderRepository: this.orderRepository,
            strategies: defaultStrategies
        });

        // 4. Wire Use Cases with Injected Dependencies
        this.registerRiderUseCase = new RegisterRiderUseCase({
            riderRepository: this.riderRepository,
            storageService: this.storageService
        });

        this.getRidersUseCase = new GetRidersUseCase({
            riderRepository: this.riderRepository
        });

        this.updateRiderStatusUseCase = new UpdateRiderStatusUseCase({
            riderRepository: this.riderRepository
        });

        this.updateRiderLocationUseCase = new UpdateRiderLocationUseCase({
            riderRepository: this.riderRepository
        });

        this.setRiderEnabledUseCase = new SetRiderEnabledUseCase({
            riderRepository: this.riderRepository
        });

        this.manualAssignOrderUseCase = new ManualAssignOrderUseCase({
            riderRepository: this.riderRepository,
            orderRepository: this.orderRepository
        });

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
