/**
 * Shared domain constants, roles, and status enums
 */

export const PlatformRoles = {
    SUPER_ADMIN: 'SUPER_ADMIN',
    PLATFORM_SUPER_ADMIN: 'SUPER_ADMIN',
    PLATFORM_OPERATIONS: 'PLATFORM_OPERATIONS',
    PLATFORM_SUPPORT: 'PLATFORM_SUPPORT',
    PLATFORM_FINANCE: 'PLATFORM_FINANCE',
    PLATFORM_FULFILLMENT_ADMIN: 'PLATFORM_FULFILLMENT_ADMIN'
};

export const TenantRoles = {
    TENANT_ADMIN: 'TENANT_ADMIN',
    TENANT_OWNER: 'TENANT_OWNER',
    PHARMACY_STAFF: 'PHARMACY_STAFF',
    PHARMACIST: 'PHARMACIST',
    ORDER_MANAGER: 'ORDER_MANAGER',
    INVENTORY_MANAGER: 'INVENTORY_MANAGER',
    DISPATCHER: 'DISPATCHER',
    RIDER: 'RIDER',
    TENANT_RIDER: 'TENANT_RIDER'
};

export const CustomerRole = 'CUSTOMER';
export const RiderRole = 'RIDER';

export const isPlatformSuperAdmin = (role) => {
    return role === 'SUPER_ADMIN' || role === 'PLATFORM_SUPER_ADMIN' || role === 'admin';
};

export const TenantStatus = {
    PENDING: 'PENDING',
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
    SUSPENDED: 'SUSPENDED'
};

export const BranchStatus = {
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE'
};

export const ProductListingStatus = {
    DRAFT: 'DRAFT',
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
    OUT_OF_STOCK: 'OUT_OF_STOCK',
    DISCONTINUED: 'DISCONTINUED'
};

export const InventorySource = {
    ASHVIN: 'ASHVIN',
    CSQUARE: 'CSQUARE',
    OTHER_POS: 'OTHER_POS',
    ERP: 'ERP',
    MANUAL: 'MANUAL'
};

export const StockStatus = {
    IN_STOCK: 'IN_STOCK',
    LOW_STOCK: 'LOW_STOCK',
    OUT_OF_STOCK: 'OUT_OF_STOCK'
};

export const MultiTenantOrderStatus = {
    SUBMITTED: 'SUBMITTED',
    PHARMACY_REVIEW: 'PHARMACY_REVIEW',
    ACCEPTED: 'ACCEPTED',
    PROCESSING: 'PROCESSING',
    READY_FOR_DISPATCH: 'READY_FOR_DISPATCH',
    OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
    REJECTED: 'REJECTED'
};

export const FulfillmentMode = {
    VENDOR_FULFILLMENT: 'VENDOR_FULFILLMENT',
    ASHVIN_FULFILLMENT: 'ASHVIN_FULFILLMENT',
    EXTERNAL_FULFILLMENT: 'EXTERNAL_FULFILLMENT'
};

export const RiderStatus = {
    OFFLINE: 'OFFLINE',
    AVAILABLE: 'AVAILABLE',
    ASSIGNED: 'ASSIGNED',
    PICKING_UP: 'PICKING_UP',
    OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
    DELIVERED: 'DELIVERED',
    SUSPENDED: 'SUSPENDED'
};

export const MedicineRequestStatus = {
    REQUESTED: 'REQUESTED',
    UNDER_REVIEW: 'UNDER_REVIEW',
    PROPOSAL_SENT: 'PROPOSAL_SENT',
    CUSTOMER_APPROVED: 'CUSTOMER_APPROVED',
    CUSTOMER_REJECTED: 'CUSTOMER_REJECTED',
    PHARMACY_REJECTED: 'PHARMACY_REJECTED',
    EXPIRED: 'EXPIRED',
    CONVERTED_TO_ORDER: 'CONVERTED_TO_ORDER',
    CANCELLED: 'CANCELLED'
};

export const IntegrationProvider = {
    CSQUARE: 'CSQUARE',
    MANUAL: 'MANUAL',
    OTHER_POS: 'OTHER_POS'
};

export const IntegrationStatus = {
    CONNECTED: 'CONNECTED',
    DISCONNECTED: 'DISCONNECTED',
    ERROR: 'ERROR'
};

export default {
    PlatformRoles,
    TenantRoles,
    CustomerRole,
    TenantStatus,
    BranchStatus,
    ProductListingStatus,
    InventorySource,
    StockStatus,
    MultiTenantOrderStatus,
    FulfillmentMode,
    RiderStatus,
    MedicineRequestStatus,
    IntegrationProvider,
    IntegrationStatus
};
