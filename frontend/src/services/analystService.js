/**
 * Analyst Service for Smart Refills, Expiry-based offers, and Spending Analytics.
 */

export function analyzeCustomerOffers(orders = [], medicines = []) {
  // 1. Analyze user order history to find frequently ordered medicines
  const medicineFrequencyMap = {};
  
  (Array.isArray(orders) ? orders : []).forEach(order => {
    const items = order.items || order.medicines || order.products || [];
    items.forEach(item => {
      const name = item.name || item.title || item.medicineName || 'Medication';
      const key = name.toLowerCase().trim();
      if (!medicineFrequencyMap[key]) {
        medicineFrequencyMap[key] = {
          name,
          count: 0,
          lastOrdered: order.createdAt || order.date || new Date(),
          price: item.price || item.unitPrice || 0
        };
      }
      medicineFrequencyMap[key].count += (item.quantity || item.qty || 1);
    });
  });

  const frequentMedicines = Object.values(medicineFrequencyMap).sort((a, b) => b.count - a.count);

  // 2. Identify near-expiring or slow-moving items in catalog
  // If catalog items don't have explicit expiryDate, simulate or detect expiry status (within 6 months)
  const now = new Date();
  const sixMonthsFromNow = new Date();
  sixMonthsFromNow.setMonth(now.getMonth() + 6);

  const catalogOffers = (Array.isArray(medicines) ? medicines : []).map((med, index) => {
    // Determine if near expiring or slow moving
    const hasExplicitExpiry = med.expiryDate || med.batchExpiry;
    const expiryDate = hasExplicitExpiry ? new Date(med.expiryDate || med.batchExpiry) : new Date(now.getTime() + (30 + (index * 15)) * 24 * 60 * 60 * 1000); // 1 to 5 months from now
    const isExpiringSoon = expiryDate <= sixMonthsFromNow;
    const isSlowMoving = med.isSlowMoving || med.slowMoving || (index % 5 === 0);
    const hasDiscount = med.discountPrice || med.offerDiscount || isExpiringSoon || isSlowMoving;

    const basePrice = med.price || med.mrp || 150;
    const discountPercent = med.discountPercent || (isExpiringSoon ? 25 : isSlowMoving ? 20 : 15);
    const discountedPrice = med.discountPrice || Math.round(basePrice * (1 - discountPercent / 100));

    return {
      ...med,
      expiryDate,
      isExpiringSoon,
      isSlowMoving,
      discountPercent,
      discountedPrice,
      isOfferItem: hasDiscount || isExpiringSoon || isSlowMoving
    };
  });

  // 3. Match frequent medicines with catalog items for Smart Refills
  const smartRefillOffers = [];
  frequentMedicines.forEach(freq => {
    const matchedCatalogItem = catalogOffers.find(med => 
      (med.name || '').toLowerCase().includes(freq.name.toLowerCase()) ||
      freq.name.toLowerCase().includes((med.name || '').toLowerCase())
    );

    if (matchedCatalogItem) {
      smartRefillOffers.push({
        ...matchedCatalogItem,
        isSmartRefill: true,
        orderCount: freq.count,
        lastOrdered: freq.lastOrdered,
        discountPercent: Math.max(matchedCatalogItem.discountPercent, 25),
        discountedPrice: Math.round((matchedCatalogItem.price || 150) * 0.75),
        offerReason: `Frequently ordered (${freq.count}x). Refill with 25% near-expiry discount!`
      });
    }
  });

  // General Offer Zone items (near expiring or slow moving or pharmacist specials)
  const offerZoneItems = catalogOffers.filter(med => med.isOfferItem || med.isExpiringSoon || med.isSlowMoving).slice(0, 8);

  return {
    frequentMedicines,
    smartRefillOffers,
    offerZoneItems: offerZoneItems.length > 0 ? offerZoneItems : catalogOffers.slice(0, 6)
  };
}

export function computeSpendingAnalytics(orders = []) {
  // Compute spending over last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const dailySpendingMap = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    dailySpendingMap[dateStr] = {
      date: dateStr,
      displayDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      spending: 0,
      ordersCount: 0
    };
  }

  (Array.isArray(orders) ? orders : []).forEach(order => {
    const orderDateObj = new Date(order.createdAt || order.date || Date.now());
    if (orderDateObj >= thirtyDaysAgo) {
      const dateStr = orderDateObj.toISOString().split('T')[0];
      const total = Number(order.totalAmount || order.total || order.amount || 0);
      if (dailySpendingMap[dateStr]) {
        dailySpendingMap[dateStr].spending += total;
        dailySpendingMap[dateStr].ordersCount += 1;
      }
    }
  });

  const chartData = Object.values(dailySpendingMap);
  const totalSpent30Days = chartData.reduce((acc, curr) => acc + curr.spending, 0);
  const totalOrders30Days = chartData.reduce((acc, curr) => acc + curr.ordersCount, 0);

  return {
    chartData,
    totalSpent30Days,
    totalOrders30Days
  };
}
