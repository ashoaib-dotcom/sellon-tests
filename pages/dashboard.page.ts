import { Page, expect } from '@playwright/test';

export class DashboardPage {
  constructor(private page: Page) {}

  async waitForDashboard() {
    console.log('⏳ Waiting for dashboard to render...');

    // Wait for load state
    await this.page.waitForLoadState('load', { timeout: 60000 });

    // Wait for menu icon (signals app shell is ready)
    try {
      await this.page.locator('.menu-icon').waitFor({ state: 'visible', timeout: 60000 });
      console.log('✅ Menu icon visible - app shell ready');
    } catch {
      console.log('⚠️ Menu icon not found - waiting longer...');
      await this.page.waitForTimeout(10000);
    }

    // Wait for blocking modal to disappear
    try {
      await this.page.locator('lb-modal-blocking, lb-modal.blocking').waitFor({
        state: 'hidden',
        timeout: 30000
      });
      console.log('✅ Blocking modal gone');
    } catch {
      console.log('⚠️ No blocking modal');
    }

    // Wait for Angular change detection
    await this.page.waitForTimeout(5000);

    // Debug info
    console.log('URL:', this.page.url());
    const headings = await this.page.getByRole('heading').allInnerTexts();
    console.log('Headings:', headings);

    if (headings.length === 0) {
      console.log('⚠️ No headings found - waiting more...');
      await this.page.waitForTimeout(5000);
      const headings2 = await this.page.getByRole('heading').allInnerTexts();
      console.log('Headings after extra wait:', headings2);
    }

    await this.screenshot('debug-dashboard');
  }

  async expectAllSectionsVisible() {
    await this.waitForDashboard();

    await expect(this.page.getByRole('heading', { name: 'Products' }))
      .toBeVisible({ timeout: 60000 });
    console.log('✅ Products visible');

    await expect(this.page.getByRole('heading', { name: 'Orders' }))
      .toBeVisible({ timeout: 30000 });
    console.log('✅ Orders visible');

    await expect(this.page.getByRole('heading', { name: 'Delivery Rate' }))
      .toBeVisible({ timeout: 30000 });
    console.log('✅ Delivery Rate visible');

    await expect(this.page.getByRole('heading', { name: 'Cancel Rate' }))
      .toBeVisible({ timeout: 30000 });
    console.log('✅ Cancel Rate visible');
  }

  async expectProductsSectionVisible() {
    await this.waitForDashboard();
    await expect(this.page.getByRole('heading', { name: 'Products' }))
      .toBeVisible({ timeout: 60000 });
  }

  async expectOrdersSectionVisible() {
    await this.waitForDashboard();
    await expect(this.page.getByRole('heading', { name: 'Orders' }))
      .toBeVisible({ timeout: 30000 });
  }

  async expectDeliveryRateVisible() {
    await this.waitForDashboard();
    await expect(this.page.getByRole('heading', { name: 'Delivery Rate' }))
      .toBeVisible({ timeout: 30000 });
  }

  async expectCancelRateVisible() {
    await this.waitForDashboard();
    await expect(this.page.getByRole('heading', { name: 'Cancel Rate' }))
      .toBeVisible({ timeout: 30000 });
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
      console.log(`📸 Screenshot: ${name}.png`);
    } catch {
      // ignore
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