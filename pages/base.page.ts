import { Page } from '@playwright/test';

export class BasePage {
  constructor(protected page: Page) {}

  async screenshot(name: string) {
    await this.page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  }

  async getBodyText() {
    return await this.page.locator('body').innerText();
  }

  async waitForLoad(seconds: number = 5) {
    await this.page.waitForTimeout(seconds * 1000);
  }

  async pressEscape() {
    try {
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(2000);
    } catch {}
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