export const IntegrationEventType = Object.freeze({
  UserActivated: 'UserActivated',
  PuidCreated: 'PuidCreated',
  PrescriptionUploaded: 'PrescriptionUploaded',
  PrescriptionProcessingCompleted: 'PrescriptionProcessingCompleted',
  PrescriptionReviewRequired: 'PrescriptionReviewRequired',
  PrescriptionApproved: 'PrescriptionApproved',
  PrescriptionRejected: 'PrescriptionRejected',
  PrescriptionRemoved: 'PrescriptionRemoved',
  OrderCreated: 'OrderCreated',
  OrderConfirmed: 'OrderConfirmed',
  OrderCancelled: 'OrderCancelled',
  InventoryReserved: 'InventoryReserved',
  InventoryReleased: 'InventoryReleased',
  InventoryDeducted: 'InventoryDeducted',
  DeliveryAssigned: 'DeliveryAssigned',
  DeliveryCompleted: 'DeliveryCompleted'
});

export const IntegrationProviderType = Object.freeze({
  DATABASE: 'DATABASE',
  KAFKA: 'KAFKA',
  RABBITMQ: 'RABBITMQ',
  AWS_SQS: 'AWS_SQS',
  WEBHOOK: 'WEBHOOK'
});

export const OutboxStatus = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SENT: 'SENT',
  RETRY: 'RETRY',
  FAILED: 'FAILED',
  DEAD_LETTER: 'DEAD_LETTER'
});
