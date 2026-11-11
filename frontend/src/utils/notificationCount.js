export function getUnreadNotificationsCount(notifications = []) {
  const unreadIds = new Set();
  for (const notification of Array.isArray(notifications) ? notifications : []) {
    const id = String(notification?.id || notification?.notificationId || '').trim();
    if (id && notification?.read !== true) unreadIds.add(id);
  }
  return unreadIds.size;
}
