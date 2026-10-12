/**
 * Domain-specific error hierarchy with stable error codes
 */

export class DomainError extends Error {
    constructor(message, code = 'DOMAIN_ERROR', status = 400, details = null) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.status = status;
        this.details = details;
    }

    toJSON(requestId = null) {
        return {
            success: false,
            error: {
                code: this.code,
                message: this.message,
                status: this.status,
                details: this.details,
                requestId: requestId || undefined
            }
        };
    }
}

export class TenantAccessDeniedError extends DomainError {
    constructor(message = 'You do not have access to this pharmacy tenant.', details = null) {
        super(message, 'TENANT_ACCESS_DENIED', 403, details);
    }
}

export class BranchAccessDeniedError extends DomainError {
    constructor(message = 'You do not have access to this pharmacy branch.', details = null) {
        super(message, 'BRANCH_ACCESS_DENIED', 403, details);
    }
}

export class CustomerAccessDeniedError extends DomainError {
    constructor(message = 'You do not have access to this customer profile or order.', details = null) {
        super(message, 'CUSTOMER_ACCESS_DENIED', 403, details);
    }
}

export class OutOfServiceRadiusError extends DomainError {
    constructor(distanceKm, radiusKm, branchName = 'this branch') {
        super(
            `Delivery location is ${distanceKm} km away, exceeding ${branchName}'s service radius of ${radiusKm} km.`,
            'OUT_OF_SERVICE_RADIUS',
            422,
            { distanceKm, radiusKm }
        );
    }
}

export class InsufficientStockError extends DomainError {
    constructor(productName, requestedQty, availableQty) {
        super(
            `Insufficient stock for "${productName}". Requested: ${requestedQty}, Available: ${availableQty}.`,
            'INSUFFICIENT_STOCK',
            409,
            { productName, requestedQty, availableQty }
        );
    }
}

export class InvalidCouponError extends DomainError {
    constructor(message = 'Coupon code is invalid, expired, or requirements not met.', details = null) {
        super(message, 'INVALID_COUPON', 422, details);
    }
}

export class StackingRuleViolationError extends DomainError {
    constructor(message = 'The combination of promotions, coupons, and reward points violates pricing stacking rules.', details = null) {
        super(message, 'STACKING_RULE_VIOLATION', 422, details);
    }
}

export class IdempotencyConflictError extends DomainError {
    constructor(message = 'An identical operation is currently being processed or has already completed.', details = null) {
        super(message, 'IDEMPOTENCY_CONFLICT', 409, details);
    }
}

export class IntegrationUnavailableError extends DomainError {
    constructor(provider = 'External POS', message = 'Provider is unreachable or offline.') {
        super(`${provider} integration error: ${message}`, 'INTEGRATION_UNAVAILABLE', 503, { provider });
    }
}

export default {
    DomainError,
    TenantAccessDeniedError,
    BranchAccessDeniedError,
    CustomerAccessDeniedError,
    OutOfServiceRadiusError,
    InsufficientStockError,
    InvalidCouponError,
    StackingRuleViolationError,
    IdempotencyConflictError,
    IntegrationUnavailableError
};
