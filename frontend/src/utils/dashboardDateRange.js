// All ranges use the operator's local calendar and an exclusive end boundary.
export const DASHBOARD_PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' }
];

export function getDashboardDateRange(period = 'today', now = new Date()) {
  if (period === 'all') return {};
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  if (period === 'yesterday') {
    end.setTime(start.getTime());
    start.setDate(start.getDate() - 1);
  } else if (period === 'week') {
    start.setDate(start.getDate() - 6);
  } else if (period === 'month') {
    start.setDate(1);
  } else if (period === 'year') {
    start.setMonth(0, 1);
  } else if (period !== 'today') {
    throw new Error('Unsupported dashboard period: ' + period);
  }
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

export function isWithinDashboardRange(value, range) {
  if (!range.startDate && !range.endDate) return true;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp)
    && (!range.startDate || timestamp >= Date.parse(range.startDate))
    && (!range.endDate || timestamp < Date.parse(range.endDate));
}
