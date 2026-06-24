import { Page, expect } from '@playwright/test';

export class NavigationPage {
  constructor(private page: Page) {}

  async openSidebar() {
    await this.page.locator('.menu-icon').click();
    await this.page.waitForTimeout(2000);
  }

  async closeSidebar() {
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(1000);
  }

  async expectMenuIconVisible() {
    await expect(this.page.locator('.menu-icon')).toBeVisible();
  }

  async expectAppShellVisible() {
    await expect(this.page.locator('.menu-icon')).toBeVisible();
  }

  async openProfileDropdown() {
    // Click the profile/user button in the top bar
    const profileButton = this.page.locator(
      '[data-testid="profile-button"], .profile-button, .user-button, .avatar, [aria-label="Profile"], [aria-label="User menu"]'
    ).first();
    await profileButton.click();
    await this.page.waitForTimeout(1000);
  }

  async closeProfileDropdown() {
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(500);
  }

  async clickProfileMenuItem(itemText: string) {
    const menuItem = this.page.getByRole('menuitem', { name: itemText }).or(
      this.page.locator('[role="menu"], .dropdown-menu, .profile-dropdown').getByText(itemText, { exact: true })
    ).first();
    await menuItem.click();
    await this.page.waitForTimeout(1000);
  }

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

  getProductDetailsLink() {
    return this.page.getByText('Product Details', { exact: true });
  }

  async getMenuItemTexts(): Promise<string[]> {
    return this.page.locator('.menu-icon ~ *, nav a, nav .item').allInnerTexts().catch(() => []);
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
