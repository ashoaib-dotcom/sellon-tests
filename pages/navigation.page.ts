import { Page } from '@playwright/test';

export class NavigationPage {
  constructor(private page: Page) {}

  async openSidebar() {
    try {
      const modal = this.page.locator('lb-modal.blocking');
      if (await modal.isVisible()) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(2000);
      }
    } catch {}

    await this.page.locator('.menu-icon').click();
    await this.page.waitForTimeout(2000);
  }

  async closeSidebar() {
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(2000);
    await this.page.locator('body').click({ position: { x: 960, y: 400 } });
    await this.page.waitForTimeout(2000);
  }

  async navigateToProducts() {
    await this.openSidebar();

    const productItems = this.page.locator('nav').getByText('Product', { exact: true });
    await productItems.first().click();
    await this.page.waitForTimeout(2000);

    const subItem = this.page.locator('nav').getByText('Product', { exact: true }).nth(1);
    await subItem.scrollIntoViewIfNeeded();
    await subItem.dispatchEvent('click');
    await this.page.waitForTimeout(15000);

    await this.closeSidebar();
  }
} 