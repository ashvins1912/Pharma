const utcDay = value => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

export function buildInventoryAlerts(items = [], {
  lowStockThreshold = 3,
  expiringThresholdDays = 30,
  now = new Date()
} = {}) {
  const today = utcDay(now);
  if (today === null) throw new TypeError('A valid current date is required.');

  const lowThreshold = Math.max(0, Number(lowStockThreshold) || 0);
  const expiryThreshold = Math.max(0, Number(expiringThresholdDays) || 0);
  const expired = [];
  const expiringSoon = [];
  const lowStock = [];

  for (const medicine of Array.isArray(items) ? items : []) {
    for (const batch of medicine.expiredBatchAvailability || []) {
      const expiryDay = batch.expiryDate ? utcDay(batch.expiryDate) : null;
      if (expiryDay === null || Number(batch.stockQuantity || 0) <= 0) continue;
      const daysLeft = Math.round((expiryDay - today) / 86400000);
      if (daysLeft < 0) {
        expired.push({
          ...medicine,
          batchNumber: batch.batchNumber || '',
          expiryDate: batch.expiryDate,
          stock: Number(batch.stockQuantity || 0),
          availableQuantity: Number(batch.availableQuantity || 0),
          daysLeft
        });
      }
    }

    for (const batch of medicine.batchAvailability || []) {
      if (!batch.expiryDate || Number(batch.stockQuantity || 0) <= 0) continue;
      const expiryDay = utcDay(batch.expiryDate);
      if (expiryDay === null) continue;
      const daysLeft = Math.round((expiryDay - today) / 86400000);
      if (daysLeft >= 0 && daysLeft <= expiryThreshold) {
        expiringSoon.push({
          ...medicine,
          batchNumber: batch.batchNumber || '',
          expiryDate: batch.expiryDate,
          stock: Number(batch.stockQuantity || 0),
          availableQuantity: Number(batch.availableQuantity || 0),
          daysLeft
        });
      }
    }

    if (Number(medicine.batchCount || 0) > 0
      && Number(medicine.availableQuantity || 0) <= lowThreshold) {
      lowStock.push({ ...medicine, stock: Number(medicine.availableQuantity || 0) });
    }
  }

  return {
    expiredCount: expired.length,
    expiringSoonCount: expiringSoon.length,
    lowStockCount: lowStock.length,
    totalAlerts: expired.length + expiringSoon.length + lowStock.length,
    expired: expired.slice(0, 20),
    expiringSoon: expiringSoon.slice(0, 20),
    lowStock: lowStock.slice(0, 20)
  };
}
