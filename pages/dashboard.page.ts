import { Page, expect } from '@playwright/test';

export class DashboardPage {
  constructor(private page: Page) {}

  // Locators
  private productsHeading = () => this.page.getByRole('heading', { name: 'Products' });
  private ordersHeading = () => this.page.getByRole('heading', { name: 'Orders' });
  private deliveryRateHeading = () => this.page.getByRole('heading', { name: 'Delivery Rate' });
  private cancelRateHeading = () => this.page.getByRole('heading', { name: 'Cancel Rate' });

  // Assertions
  async expectAllSectionsVisible() {
    await expect(this.productsHeading()).toBeVisible({ timeout: 60000 });
    await expect(this.ordersHeading()).toBeVisible();
    await expect(this.deliveryRateHeading()).toBeVisible();
    await expect(this.cancelRateHeading()).toBeVisible();
  }

  async getBodyText() {
    return await this.page.locator('body').innerText();
  }
}