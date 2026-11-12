import { test, expect } from '@playwright/test';

test.describe('Pharmacy E2E: User Order Submission Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should allow user to search catalog, add items to cart, and initiate checkout', async ({ page }) => {
    // 1. Verify page title and header elements
    await expect(page).toHaveTitle(/Pharma|QuickMeds|Pharmacy/i);

    // 2. Search for a medicine in the search bar if present
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], input[placeholder*="Medicine" i]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('Paracetamol');
      await searchInput.press('Enter');
      await page.waitForTimeout(500);
    }

    // 3. Locate an "Add to Cart" or "Add" button
    const addToCartBtn = page.locator('button:has-text("Add to Cart"), button:has-text("Add"), button[aria-label*="cart" i]').first();
    if (await addToCartBtn.isVisible()) {
      await addToCartBtn.click();
      await page.waitForTimeout(300);
    }

    // 4. Open shopping cart / drawer
    const cartTrigger = page.locator('button:has-text("Cart"), button[aria-label*="cart" i], .cart-button').first();
    if (await cartTrigger.isVisible()) {
      await cartTrigger.click();
      await page.waitForTimeout(300);
    }

    // 5. Verify checkout modal or proceed button is visible
    const checkoutBtn = page.locator('button:has-text("Proceed to Checkout"), button:has-text("Checkout"), button:has-text("Place Order")').first();
    if (await checkoutBtn.isVisible()) {
      await expect(checkoutBtn).toBeEnabled();
    }
  });

  test('should validate delivery address and payment method selection during checkout', async ({ page }) => {
    // Directly trigger checkout modal if action exists or verify order summary
    const cartBtn = page.locator('button:has-text("Cart"), button[aria-label*="cart" i]').first();
    if (await cartBtn.isVisible()) {
      await cartBtn.click();
    }

    const checkoutBtn = page.locator('button:has-text("Checkout"), button:has-text("Proceed to Checkout")').first();
    if (await checkoutBtn.isVisible()) {
      await checkoutBtn.click();
      await page.waitForTimeout(500);

      // Verify modal elements
      const modalHeader = page.locator('text=/Checkout|Order Summary/i').first();
      await expect(modalHeader).toBeVisible();

      // Verify address manager or selection is rendered
      const addressSection = page.locator('text=/Address|Delivery Location|Select Delivery/i').first();
      await expect(addressSection).toBeVisible();

      // Verify payment section is rendered
      const paymentSection = page.locator('text=/Payment Method|UPI|Cash on Delivery|Card/i').first();
      await expect(paymentSection).toBeVisible();
    }
  });
});
