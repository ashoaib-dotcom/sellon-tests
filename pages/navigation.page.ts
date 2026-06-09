import { Page } from '@playwright/test';

export class NavigationPage {
  constructor(private page: Page) {}

  async navigateToDashboard() {
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

    // Click the top-level Dashboard menu item
    await this.page.locator('nav').getByText('Dashboard', { exact: true }).first().click();
    await this.page.waitForTimeout(5000);

    // Close sidebar
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(1000);
  }

  async navigateToProducts() {
    // Dismiss any blocking modal (same as orders navigation)
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

    // Check if the Product submenu is already expanded (count >= 2 means parent + child visible)
    const productItems = this.page.locator('nav').getByText('Product', { exact: true });
    const visibleCount = await productItems.count();

    if (visibleCount < 2) {
      // Submenu is collapsed — click parent to expand it
      await productItems.first().click();
      await this.page.waitForTimeout(2000);
    }
    // If count >= 2, submenu is already open — clicking parent would collapse it, so skip

    // Click the "Product" sub-item
    const subItem = this.page.locator('nav').getByText('Product', { exact: true }).nth(1);
    await subItem.scrollIntoViewIfNeeded();
    await subItem.dispatchEvent('click');
    await this.page.waitForTimeout(15000);

    // Close sidebar
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(2000);
  }
}
