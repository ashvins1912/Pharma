export const roundCurrency = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const calculateSurplusUnitDiscount = (unitPrice, campaign, alreadyApplied = 0, quantity = 1) => {
    const price = Number(unitPrice);
    const qty = Number(quantity);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty < 1) return 0;
    const rawDiscount = campaign?.discountType === 'fixed'
        ? Number(campaign.discountValue)
        : price * Number(campaign?.discountValue || 0) / 100;
    if (!Number.isFinite(rawDiscount) || rawDiscount <= 0) return 0;
    const capRemaining = campaign?.maxDiscountAmount == null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Number(campaign.maxDiscountAmount) - Number(alreadyApplied || 0));
    return roundCurrency(Math.max(0, Math.min(price, rawDiscount, capRemaining / qty)));
};
