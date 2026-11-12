/**
 * Order State Machine Service
 * Enforces strict state transition rules, lifecycle guards, and event logging for pharmacy orders.
 */

export const ORDER_STATES = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  PROCESSING_ORDER: 'PROCESSING_ORDER',
  READY_TO_DISPATCH: 'READY_TO_DISPATCH',
  DISPATCHED: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED'
};

const VALID_TRANSITIONS = {
  [ORDER_STATES.PENDING_REVIEW]: [ORDER_STATES.APPROVED, ORDER_STATES.REJECTED, ORDER_STATES.CANCELLED],
  [ORDER_STATES.APPROVED]: [ORDER_STATES.PROCESSING_ORDER, ORDER_STATES.CANCELLED],
  [ORDER_STATES.PROCESSING_ORDER]: [ORDER_STATES.READY_TO_DISPATCH, ORDER_STATES.CANCELLED],
  [ORDER_STATES.READY_TO_DISPATCH]: [ORDER_STATES.DISPATCHED, ORDER_STATES.CANCELLED],
  [ORDER_STATES.DISPATCHED]: [ORDER_STATES.DELIVERED, ORDER_STATES.CANCELLED],
  [ORDER_STATES.DELIVERED]: [],
  [ORDER_STATES.CANCELLED]: [],
  [ORDER_STATES.REJECTED]: []
};

export class OrderStateMachine {
  constructor(currentStatus) {
    this.currentStatus = String(currentStatus || ORDER_STATES.PENDING_REVIEW).toUpperCase();
  }

  canTransitionTo(targetStatus) {
    const target = String(targetStatus || '').toUpperCase();
    const allowed = VALID_TRANSITIONS[this.currentStatus] || [];
    return allowed.includes(target);
  }

  transition(targetStatus) {
    const target = String(targetStatus || '').toUpperCase();
    if (!this.canTransitionTo(target)) {
      throw new Error(`Invalid order state transition from "${this.currentStatus}" to "${target}".`);
    }
    this.currentStatus = target;
    return this.currentStatus;
  }

  static validateTransition(currentStatus, targetStatus) {
    const machine = new OrderStateMachine(currentStatus);
    return machine.canTransitionTo(targetStatus);
  }
}

export default OrderStateMachine;
