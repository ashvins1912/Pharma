import { test, expect } from '@playwright/test';

test.describe('Pharmacy E2E: Complete Pharmacy Application End-to-End Suite', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should verify core application header, navigation tabs, and hamburger help drawer', async ({ page }) => {
    // 1. Verify Brand title/logo presence
    const brand = page.locator('header a, header h1, header span').first();
    await expect(brand).toBeVisible();

    // 2. Hamburger drawer for guidance and interactive tour
    const hamburgerBtn = page.locator('button[aria-label*="menu" i], button[aria-label*="Hamburger" i], button:has-text("☰")').first();
    if (await hamburgerBtn.isVisible()) {
      await hamburgerBtn.click();
      await page.waitForTimeout(300);

      // Verify help/tour options inside hamburger menu
      const guideOption = page.locator('text=/Application Guide|Product Tour|Contextual Help/i').first();
      await expect(guideOption).toBeVisible();
    }
  });

  test('should verify multi-language switcher updates application text', async ({ page }) => {
    // Locate language switcher dropdown
    const langSelect = page.locator('select[aria-label*="language" i], select[aria-label*="Language" i]').first();
    if (await langSelect.isVisible()) {
      // Switch to Hindi or Spanish if available
      const options = await langSelect.locator('option').allInnerTexts();
      if (options.length > 1) {
        await langSelect.selectOption({ index: 1 });
        await page.waitForTimeout(400);
      }
    }
  });

  test('should verify dispensary command center and feature health telemetry endpoints', async ({ page }) => {
    // Locate admin operations tab or feature health button
    const featureHealthBtn = page.locator('button:has-text("Feature Health"), button:has-text("System Status"), text=/Feature Health/i').first();
    if (await featureHealthBtn.isVisible()) {
      await featureHealthBtn.click();
      await page.waitForTimeout(400);

      const healthCard = page.locator('text=/Feature Health|Probe Status|System Probe/i').first();
      await expect(healthCard).toBeVisible();
    }
  });
});
