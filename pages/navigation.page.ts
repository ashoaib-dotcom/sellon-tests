import { Page } from '@playwright/test';

export class NavigationPage {
  constructor(private page: Page) {}

  // Dismiss any lb-modal.blocking that is currently visible.
  private async dismissBlockingModal(): Promise<void> {
    try {
      const modal = this.page.locator('lb-modal.blocking');
      if (!await modal.isVisible({ timeout: 3000 })) return;

      const noBtn = modal.getByText('No', { exact: true });
      if (await noBtn.count() > 0) {
        await noBtn.click();
        await this.page.waitForTimeout(1500);
        return;
      }

      const yesBtn = modal.getByText('Yes', { exact: true });
      if (await yesBtn.count() > 0) {
        await yesBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
        await this.page.waitForTimeout(3000);
        await this.page.locator('.menu-icon').waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
        await this.page.waitForTimeout(2000);
        return;
      }

      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(1500);
    } catch {}
  }

  async closeSidebar() {
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(2000);
    await this.page.locator('body').click({ position: { x: 960, y: 400 } });
    await this.page.waitForTimeout(2000);
  }

  async navigateToProducts() {
    // Handle any blocking modal first
    await this.dismissBlockingModal();

    // Open sidebar — same simple pattern as orders navigation:
    // if nav is already visible, skip the menu icon click; otherwise open it.
    const nav = this.page.locator('nav');
    const sidebarOpen = await nav.isVisible({ timeout: 3000 }).catch(() => false);
    if (!sidebarOpen) {
      await this.page.locator('.menu-icon').click();
      await this.page.waitForTimeout(2000);
    }

    // Click the "Product" parent item to expand its sub-menu
    const productItems = this.page.locator('nav').getByText('Product', { exact: true });
    await productItems.first().click();
    await this.page.waitForTimeout(2000);

    // Click the "Product" sub-item (same approach orders uses: dispatchEvent)
    const subItem = this.page.locator('nav').getByText('Product', { exact: true }).nth(1);
    await subItem.waitFor({ state: 'visible', timeout: 30000 });
    await subItem.scrollIntoViewIfNeeded();
    await subItem.dispatchEvent('click');
    await this.page.waitForTimeout(15000);

    // Close sidebar
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(2000);
  }
}
