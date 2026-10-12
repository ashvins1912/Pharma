import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyOrderSearch, paginationResult } from './orderSearch.js';
import dataStore from '../dataStore.js';

test('classifies public order numbers and Mongo IDs without conflating them', () => {
    assert.deepEqual(classifyOrderSearch(' ORD-12345 '), { type: 'orderId', value: { orderNumber: 'ORD-12345', raw: 'ORD-12345' } });
    assert.deepEqual(classifyOrderSearch('507f1f77bcf86cd799439011'), { type: 'orderId', value: { objectId: '507f1f77bcf86cd799439011', orderNumber: '507F1F77BCF86CD799439011', raw: '507f1f77bcf86cd799439011' } });
});

test('accepts card order identifiers, leading #, and hex suffixes case-insensitively', () => {
    // 434EA1 from delivered card
    const res1 = classifyOrderSearch('434EA1');
    assert.equal(res1.type, 'orderId');
    assert.equal(res1.value.orderNumber, '434EA1');

    // #434EA1 with leading hash
    const res2 = classifyOrderSearch('#434EA1');
    assert.equal(res2.type, 'orderId');
    assert.equal(res2.value.orderNumber, '434EA1');

    // lowercase 434ea1
    const res3 = classifyOrderSearch('434ea1');
    assert.equal(res3.type, 'orderId');
    assert.equal(res3.value.orderNumber, '434EA1');

    // #ORD-12345 and ord-12345
    const res4 = classifyOrderSearch('#ORD-12345');
    assert.equal(res4.type, 'orderId');
    assert.equal(res4.value.orderNumber, 'ORD-12345');

    const res5 = classifyOrderSearch('ord-12345');
    assert.equal(res5.type, 'orderId');
    assert.equal(res5.value.orderNumber, 'ORD-12345');
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

test('dataStore.searchOrders finds both active and delivered orders by order ID and suffix', async () => {
    const activeRes = await dataStore.searchOrders({
        type: 'orderId',
        value: { orderNumber: 'ORD-1021', raw: 'ord-1021' },
        page: 1,
        limit: 5
    });
    assert.ok(activeRes.items.length > 0, 'Should find order ord-1021');

    // Suffix search matching ord-1021
    const suffixRes = await dataStore.searchOrders({
        type: 'orderId',
        value: { orderNumber: '1021', raw: '1021' },
        page: 1,
        limit: 5
    });
    assert.ok(suffixRes.items.length > 0, 'Should find order by suffix 1021');
});

