// Shared status matching for legacy orders where lifecycle fields may disagree.
export const normalizeOrderStatusValue = value => String(value ?? '').trim().toLowerCase();

export const orderHasStatus = (order, statuses) => {
  const accepted = statuses instanceof Set
    ? statuses
    : new Set(Array.from(statuses || [], normalizeOrderStatusValue));
  return [order?.orderStatus, order?.status]
    .some(value => accepted.has(normalizeOrderStatusValue(value)));
};

export const buildOrderStatusFilter = statuses => {
  const values = [...new Set(Array.from(statuses || [], value => String(value)))];
  return { $or: [
    { orderStatus: { $in: values } },
    { status: { $in: values } }
  ] };
};
