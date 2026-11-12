import test from 'node:test';
import assert from 'node:assert/strict';
import { getUnreadNotificationsCount } from './notificationCount.js';

test('counts unique unread notifications only', () => {
  assert.equal(getUnreadNotificationsCount([
    { id: 'n-1', read: false },
    { id: 'n-2', read: false },
    { id: 'n-1', read: false },
    { id: 'n-3', read: true }
  ]), 2);
});

test('treats legacy missing read flag as unread and ignores empty IDs', () => {
  assert.equal(getUnreadNotificationsCount([
    { notificationId: 'legacy-1' },
    { id: '' },
    { title: 'missing id' },
    null
  ]), 1);
});

test('returns zero for invalid or empty notification collections', () => {
  assert.equal(getUnreadNotificationsCount([]), 0);
  assert.equal(getUnreadNotificationsCount(null), 0);
});
