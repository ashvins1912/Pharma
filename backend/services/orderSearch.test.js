import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyOrderSearch, paginationResult } from './orderSearch.js';

test('classifies public order numbers and Mongo IDs without conflating them', () => {
    assert.deepEqual(classifyOrderSearch(' ORD-12345 '), { type: 'orderId', value: { orderNumber: 'ORD-12345' } });
    assert.deepEqual(classifyOrderSearch('507f1f77bcf86cd799439011'), { type: 'orderId', value: { objectId: '507f1f77bcf86cd799439011' } });
});

test('normalizes customer email and mobile search input', () => {
    assert.deepEqual(classifyOrderSearch(' Customer@Example.com '), { type: 'email', value: 'customer@example.com' });
    assert.deepEqual(classifyOrderSearch('+91 98765-43210'), { type: 'mobile', value: { digits: '919876543210', raw: '+91 98765-43210' } });
});

test('rejects empty and malformed search terms with a validation status', () => {
    for (const input of ['', 'customer', 'abc@example', '12345']) {
        assert.throws(() => classifyOrderSearch(input), error => error.statusCode === 422);
    }
});

test('builds stable pagination metadata for search and delivered responses', () => {
    assert.deepEqual(paginationResult([], 11, 2, 5), {
        items: [],
        pagination: { page: 2, limit: 5, total: 11, totalPages: 3, hasNextPage: true, hasPreviousPage: true }
    });
});
