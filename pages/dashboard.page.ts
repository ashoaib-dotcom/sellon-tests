import { Page, expect } from '@playwright/test';

export class DashboardPage {
  constructor(private page: Page) {}

  async expectAllSectionsVisible() {
    await expect(this.page.getByRole('heading', { name: 'Products' })).toBeVisible({ timeout: 60000 });
    await expect(this.page.getByRole('heading', { name: 'Orders' })).toBeVisible();
    await expect(this.page.getByRole('heading', { name: 'Delivery Rate' })).toBeVisible();
    await expect(this.page.getByRole('heading', { name: 'Cancel Rate' })).toBeVisible();
  }

  async expectProductsSectionVisible() {
    await expect(this.page.getByRole('heading', { name: 'Products' })).toBeVisible({ timeout: 60000 });
  }

  async expectOrdersSectionVisible() {
    await expect(this.page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  }

  async expectDeliveryRateVisible() {
    await expect(this.page.getByRole('heading', { name: 'Delivery Rate' })).toBeVisible();
  }

  async expectCancelRateVisible() {
    await expect(this.page.getByRole('heading', { name: 'Cancel Rate' })).toBeVisible();
  }

  async getBodyText() {
    return await this.page.locator('body').innerText();
  }

  async screenshot(name: string) {
    await this.page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
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