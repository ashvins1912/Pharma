import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSurplusUnitDiscount, roundCurrency } from '../backend/services/surplusSavingsPricing.js';

test('percentage surplus savings are calculated from server-side unit price', () => {
    assert.equal(calculateSurplusUnitDiscount(200, { discountType: 'percentage', discountValue: 15 }), 30);
});

test('fixed surplus savings cannot reduce a medicine below zero', () => {
    assert.equal(calculateSurplusUnitDiscount(12, { discountType: 'fixed', discountValue: 50 }), 12);
});

test('campaign maximum discount is enforced across quantities and prior items', () => {
    const campaign = { discountType: 'percentage', discountValue: 50, maxDiscountAmount: 25 };
    assert.equal(calculateSurplusUnitDiscount(100, campaign, 5, 2), 10);
    assert.equal(calculateSurplusUnitDiscount(100, campaign, 25, 1), 0);
});

test('invalid prices, quantities and discounts fail closed', () => {
    assert.equal(calculateSurplusUnitDiscount(-1, { discountType: 'fixed', discountValue: 10 }), 0);
    assert.equal(calculateSurplusUnitDiscount(100, { discountType: 'fixed', discountValue: 10 }, 0, 0), 0);
    assert.equal(calculateSurplusUnitDiscount(100, { discountType: 'percentage', discountValue: 0 }), 0);
    assert.equal(roundCurrency(1.005), 1.01);
});
