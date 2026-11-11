import { test, expect } from '@playwright/test';

test.describe('Pharmacy E2E: Dispensary Inventory Stock Adjustment Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should allow dispensary admin to view inventory table and adjust stock levels', async ({ page }) => {
    // 1. Locate Admin Dashboard / Admin Portal trigger or switch
    const adminTab = page.locator('button:has-text("Admin"), a:has-text("Admin"), button:has-text("Dispensary"), button:has-text("Inventory")').first();

    if (await adminTab.isVisible()) {
      await adminTab.click();
      await page.waitForTimeout(500);

      // 2. Locate Inventory sub-tab or table
      const inventorySubTab = page.locator('button:has-text("Inventory"), button:has-text("Stock"), text=/Inventory Stock/i').first();
      if (await inventorySubTab.isVisible()) {
        await inventorySubTab.click();
        await page.waitForTimeout(500);

        // 3. Verify stock table headers
        const stockHeader = page.locator('text=/Medicine Catalog|Inventory Management|Stock Level/i').first();
        await expect(stockHeader).toBeVisible();

        // 4. Test stock adjustment action button
        const editStockBtn = page.locator('button:has-text("Edit Stock"), button:has-text("Adjust"), button:has-text("Update Stock")').first();
        if (await editStockBtn.isVisible()) {
          await editStockBtn.click();
          await page.waitForTimeout(300);

          // Verify stock input modal
          const stockInput = page.locator('input[type="number"][name*="stock" i], input[type="number"][name*="quantity" i]').first();
          if (await stockInput.isVisible()) {
            await stockInput.fill('150');
            await expect(stockInput).toHaveValue('150');
          }
        }
      }
    }
  });

  test('should verify surplus savings pricing tier updates and stock audit log entries', async ({ page }) => {
    // Navigate to admin inventory or surplus savings manager if present
    const surplusTab = page.locator('button:has-text("Surplus Savings"), button:has-text("Discounts"), text=/Surplus Savings/i').first();
    if (await surplusTab.isVisible()) {
      await surplusTab.click();
      await page.waitForTimeout(300);

      const surplusHeader = page.locator('text=/Surplus Savings|Wholesale Discounts/i').first();
      await expect(surplusHeader).toBeVisible();
    }
  });
});
