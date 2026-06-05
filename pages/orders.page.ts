import { Page, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class OrdersPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigateToOrders() {
    try {
      const modal = this.page.locator('lb-modal.blocking');
      if (await modal.isVisible()) {
        await this.pressEscape();
      }
    } catch {}

    await this.page.locator('.menu-icon').click();
    await this.waitForLoad(2);

    const orderItems = this.page.locator('nav').getByText('Orders', { exact: true });
    await orderItems.first().click();
    await this.waitForLoad(2);

    const subItem = this.page.locator('nav').getByText('Orders', { exact: true }).nth(1);
    await subItem.scrollIntoViewIfNeeded();
    await subItem.dispatchEvent('click');
    await this.waitForLoad(15);

    await this.pressEscape();
  }

  async expectOrderTableVisible() {
    await expect(this.page.getByTitle('ID', { exact: true })).toBeVisible({ timeout: 30000 });
  }

  async getRowCount() {
    return await this.page.locator('tbody tr').count();
  }

  async getPaginationText() {
    return await this.page.locator('text=/\\d+ - \\d+ of \\d+/').innerText();
  }
}