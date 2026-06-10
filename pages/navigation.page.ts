import { Page } from '@playwright/test';

export class NavigationPage {
  constructor(private page: Page) {}

  async navigateToDashboard() {
    // Dismiss any blocking modal
    try {
      const modal = this.page.locator('lb-modal.blocking');
      if (await modal.isVisible()) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(2000);
      }
    } catch {}

    // Open sidebar
    await this.page.locator('.menu-icon').click();
    await this.page.waitForTimeout(2000);

    // Click Dashboard using force to handle viewport issues
    const dashboardItem = this.page.locator('nav').getByText('Dashboard', { exact: true }).first();
    await dashboardItem.scrollIntoViewIfNeeded();
    await dashboardItem.click({ force: true });
    await this.page.waitForTimeout(5000);

    // Close sidebar
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(1000);
  }

  async navigateToProducts() {
    // Dismiss any blocking modal
    try {
      const modal = this.page.locator('lb-modal.blocking');
      if (await modal.isVisible()) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(2000);
      }
    } catch {}

    // Open sidebar
    await this.page.locator('.menu-icon').click();
    await this.page.waitForTimeout(2000);

    // Check if Product submenu is already expanded
    const productItems = this.page.locator('nav').getByText('Product', { exact: true });
    const visibleCount = await productItems.count();

    if (visibleCount < 2) {
      // Submenu collapsed — scroll into view and force click parent
      const parentItem = productItems.first();
      await parentItem.scrollIntoViewIfNeeded();
      await this.page.waitForTimeout(500);
      await parentItem.click({ force: true });
      await this.page.waitForTimeout(2000);
    }

    // Click the Product sub-item
    const subItem = this.page.locator('nav').getByText('Product', { exact: true }).nth(1);
    await subItem.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(500);
    await subItem.dispatchEvent('click');
    await this.page.waitForTimeout(15000);

    // Close sidebar
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(2000);
  }

  async navigateToOrders() {
    // Dismiss any blocking modal
    try {
      const modal = this.page.locator('lb-modal.blocking');
      if (await modal.isVisible()) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(2000);
      }
    } catch {}

    // Open sidebar
    await this.page.locator('.menu-icon').click();
    await this.page.waitForTimeout(2000);

    // Click Orders using force
    const ordersItem = this.page.locator('nav').getByText('Orders', { exact: true }).first();
    await ordersItem.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(500);
    await ordersItem.click({ force: true });
    await this.page.waitForTimeout(5000);

    // Close sidebar
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(2000);
  }
}