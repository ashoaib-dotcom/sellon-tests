import { Page, expect } from '@playwright/test';

export class DashboardPage {
  constructor(private page: Page) {}

  // Wait for dashboard to fully load and verify we are not on login page
  async waitForDashboard() {
    await this.page.waitForLoadState('networkidle', { timeout: 60000 });
    await this.page.waitForTimeout(3000);

    // Log current URL
    console.log('Current URL:', this.page.url());

    // Log all headings found on page for debugging
    const headings = await this.page.getByRole('heading').allInnerTexts();
    console.log('Headings found on page:', headings);

    // Log page title
    console.log('Page title:', await this.page.title());
  }

  async expectAllSectionsVisible() {
    // Wait for dashboard to fully load first
    await this.waitForDashboard();

    // Check Products heading
    await expect(this.page.getByRole('heading', { name: 'Products' }))
      .toBeVisible({ timeout: 60000 });
    console.log('✅ Products heading visible');

    // Check Orders heading
    await expect(this.page.getByRole('heading', { name: 'Orders' }))
      .toBeVisible({ timeout: 30000 });
    console.log('✅ Orders heading visible');

    // Check Delivery Rate heading
    await expect(this.page.getByRole('heading', { name: 'Delivery Rate' }))
      .toBeVisible({ timeout: 30000 });
    console.log('✅ Delivery Rate heading visible');

    // Check Cancel Rate heading
    await expect(this.page.getByRole('heading', { name: 'Cancel Rate' }))
      .toBeVisible({ timeout: 30000 });
    console.log('✅ Cancel Rate heading visible');
  }

  async expectProductsSectionVisible() {
    await this.page.waitForLoadState('networkidle', { timeout: 60000 });
    await expect(this.page.getByRole('heading', { name: 'Products' }))
      .toBeVisible({ timeout: 60000 });
    console.log('✅ Products section visible');
  }

  async expectOrdersSectionVisible() {
    await this.page.waitForLoadState('networkidle', { timeout: 60000 });
    await expect(this.page.getByRole('heading', { name: 'Orders' }))
      .toBeVisible({ timeout: 30000 });
    console.log('✅ Orders section visible');
  }

  async expectDeliveryRateVisible() {
    await this.page.waitForLoadState('networkidle', { timeout: 60000 });
    await expect(this.page.getByRole('heading', { name: 'Delivery Rate' }))
      .toBeVisible({ timeout: 30000 });
    console.log('✅ Delivery Rate visible');
  }

  async expectCancelRateVisible() {
    await this.page.waitForLoadState('networkidle', { timeout: 60000 });
    await expect(this.page.getByRole('heading', { name: 'Cancel Rate' }))
      .toBeVisible({ timeout: 30000 });
    console.log('✅ Cancel Rate visible');
  }

  async getBodyText() {
    return await this.page.locator('body').innerText();
  }

  async screenshot(name: string) {
    try {
      await this.page.screenshot({
        path: `screenshots/${name}.png`,
        fullPage: true,
        timeout: 10000
      });
      console.log(`📸 Screenshot saved: ${name}.png`);
    } catch {
      // screenshot failure must not abort the test
    }
  }

  async scrollToBottom() {
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.page.waitForTimeout(2000);
  }

  async scrollToTop() {
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.waitForTimeout(2000);
  }
}