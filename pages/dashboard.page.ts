import { Page, Locator, expect } from '@playwright/test';

export class DashboardPage {
  constructor(private page: Page) {}

  async waitForDashboard() {
    console.log('Waiting for dashboard to render...');

    // Wait for load state
    await this.page.waitForLoadState('load', { timeout: 60000 });

    // Wait for menu icon (signals app shell is ready)
    try {
      await this.page.locator('.menu-icon').waitFor({ state: 'visible', timeout: 60000 });
      console.log('Menu icon visible - app shell ready');
    } catch {
      console.log('Menu icon not found - waiting longer...');
      await this.page.waitForTimeout(10000);
    }

    // Wait for blocking modal to disappear
    try {
      await this.page.locator('lb-modal-blocking, lb-modal.blocking').waitFor({
        state: 'hidden',
        timeout: 30000
      });
      console.log('Blocking modal gone');
    } catch {
      console.log('No blocking modal');
    }

    // Wait for Angular change detection
    await this.page.waitForTimeout(5000);

    // Debug info
    console.log('URL:', this.page.url());
    const headings = await this.page.getByRole('heading').allInnerTexts();
    console.log('Headings:', headings);

    if (headings.length === 0) {
      console.log('No headings found - waiting more...');
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
    console.log('Products visible');

    await expect(this.page.getByRole('heading', { name: 'Orders' }))
      .toBeVisible({ timeout: 30000 });
    console.log('Orders visible');

    await expect(this.page.getByRole('heading', { name: 'Delivery Rate' }))
      .toBeVisible({ timeout: 30000 });
    console.log('Delivery Rate visible');

    await expect(this.page.getByRole('heading', { name: 'Cancel Rate' }))
      .toBeVisible({ timeout: 30000 });
    console.log('Cancel Rate visible');
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

  async expectImportSectionVisible() {
    await this.waitForDashboard();
    await expect(this.page.getByRole('heading', { name: 'Import' }))
      .toBeVisible({ timeout: 30000 });
    console.log('Import section visible');
  }

  async expectExportSectionVisible() {
    await this.waitForDashboard();
    await expect(this.page.getByRole('heading', { name: 'Export Galaxus' }))
      .toBeVisible({ timeout: 30000 });
    console.log('Export Galaxus section visible');
  }

  async expectSchedulerSectionVisible() {
    await this.waitForDashboard();
    await expect(this.page.getByRole('heading', { name: 'Scheduler' }))
      .toBeVisible({ timeout: 30000 });
    console.log('Scheduler section visible');
  }

  async clickTVIcon() {
    await this.page.locator('.fas.fa-tv').click();
    await this.page.waitForTimeout(1000);
    console.log('TV icon clicked - layout selector opened');
  }

  async selectLayoutSlot(slotIndex: number) {
    const slots = this.page.locator('.layout-selector .slot, .layout-slot, [class*="layout"] [class*="slot"]');
    await slots.nth(slotIndex).click();
    await this.page.waitForTimeout(1000);
    console.log(`Layout slot ${slotIndex} selected`);
  }

  async selectVerticalLayout() {
    await this.page.locator('.layout-vertical, [data-layout="vertical"], .vertical-layout').first().click();
    await this.page.waitForTimeout(1000);
    console.log('Vertical layout selected');
  }

  async selectQuarterLayout() {
    await this.page.locator('.layout-quarter, [data-layout="quarter"], .quarter-layout').first().click();
    await this.page.waitForTimeout(1000);
    console.log('Quarter layout selected');
  }

  async clickExpandButton() {
    await this.page.locator('.fas.fa-expand').click();
    await this.page.waitForTimeout(1000);
    console.log('Expand (fullscreen) button clicked');
  }

  async clickCollapseRibbon() {
    await this.page.locator('.fal.fa-angle-double-up').click();
    await this.page.waitForTimeout(1000);
    console.log('Collapse ribbon clicked');
  }

  async clickExpandRibbon() {
    await this.page.locator('.fal.fa-angle-double-down').click();
    await this.page.waitForTimeout(1000);
    console.log('Expand ribbon clicked');
  }

  async dismissBlockingModal() {
    const modal = this.page.locator('lb-modal-blocking');
    const isVisible = await modal.isVisible().catch(() => false);
    if (isVisible) {
      console.log('Blocking modal detected - attempting to dismiss...');
      try {
        // Try common dismiss actions: close button, OK button, or Escape
        const closeBtn = modal.locator('button[class*="close"], button[aria-label*="close"], .modal-close').first();
        const closeBtnVisible = await closeBtn.isVisible().catch(() => false);
        if (closeBtnVisible) {
          await closeBtn.click();
        } else {
          const okBtn = modal.locator('button', { hasText: /ok|confirm|close|dismiss/i }).first();
          const okBtnVisible = await okBtn.isVisible().catch(() => false);
          if (okBtnVisible) {
            await okBtn.click();
          } else {
            await this.page.keyboard.press('Escape');
          }
        }
        await modal.waitFor({ state: 'hidden', timeout: 10000 });
        console.log('Blocking modal dismissed');
      } catch {
        console.log('Could not dismiss blocking modal');
      }
    } else {
      console.log('No blocking modal present');
    }
  }

  getMenuIcon(): Locator {
    return this.page.locator('.menu-icon');
  }

  async clickMenuIcon() {
    await this.page.locator('.menu-icon').click();
    await this.page.waitForTimeout(1000);
    console.log('Menu icon clicked - sidebar toggled');
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
      console.log(`Screenshot: ${name}.png`);
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
