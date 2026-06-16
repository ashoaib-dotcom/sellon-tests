import { Page, expect } from '@playwright/test';

export class LoginPage {
  constructor(private page: Page) {}

  // Locators (codegen-verified against stage.sellon.ch)
  private usernameField = () => this.page.getByRole('textbox', { name: 'Username' });

  private passwordField = () => this.page.getByRole('textbox', { name: 'Password' });

  private loginButton = () => this.page.getByRole('button', { name: 'Login' });

  private sessionYesButton = () => this.page.getByRole('button', { name: 'Yes' });

  // Actions
  async goto() {
    const url = process.env.BASE_URL;
    if (!url) throw new Error('BASE_URL environment variable is not set');
    const loginSelector = 'input[name="username"], input[id*="user" i], input[placeholder*="user" i], input[type="text"], input[type="password"]';

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Loading login page (attempt ${attempt})...`);
        await this.page.goto(url, { timeout: 120000, waitUntil: 'domcontentloaded' });
        await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
        await this.page.waitForSelector(loginSelector, { state: 'visible', timeout: 90000 });
        await this.page.waitForTimeout(3000);
        console.log('Login page loaded successfully');
        return;
      } catch (error) {
        console.log(`Attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
        if (attempt < 3) {
          console.log('Retrying in 10 seconds...');
          await this.page.waitForTimeout(10000);
        }
      }
    }

    console.log('Final attempt with extended timeout...');
    await this.page.goto(url, { timeout: 180000, waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await this.page.waitForSelector(loginSelector, { state: 'visible', timeout: 180000 });
    await this.page.waitForTimeout(3000);
  }

  async fillUsername(username: string) {
    const field = this.usernameField();
    await field.click();
    await field.pressSequentially(username, { delay: 150 });
    await this.page.waitForTimeout(1000);
  }

  async fillPassword(password: string) {
    const field = this.passwordField();
    await field.click();
    await field.pressSequentially(password, { delay: 150 });
    await this.page.waitForTimeout(1000);

    // Retry if password field is empty
    const value = await field.inputValue();
    if (value === '') {
      await field.click();
      await field.pressSequentially(password, { delay: 200 });
      await this.page.waitForTimeout(1000);
    }
  }

  async clickLogin() {
    const navigationPromise = this.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await this.loginButton().first().click();
    await navigationPromise;
  }

  async handleSessionPopup() {
    try {
      const sessionButton = this.page.getByRole('button', { name: /^(Yes|Continue|OK)$/i }).first();
      await sessionButton.waitFor({ state: 'visible', timeout: 15000 });
      await sessionButton.click();
      console.log('Session popup handled');
      await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    } catch {
      console.log('No session popup');
    }
  }

  async login(username: string, password: string) {
    await this.goto();
    await this.fillUsername(username);
    await this.fillPassword(password);
    await this.clickLogin();
    await this.handleSessionPopup();

    // After session popup, page may reload back to login — wait and check
    await this.page.waitForTimeout(5000);

    // If login page appears again after popup, log in once more
    try {
      const isLoginVisible = await this.passwordField().isVisible({ timeout: 10000 });
      if (isLoginVisible) {
        console.log('Reloaded to login page after session popup — logging in again...');
        await this.fillUsername(username);
        await this.fillPassword(password);
        await this.clickLogin();
        await this.page.waitForTimeout(5000);
      }
    } catch {
      console.log('No re-login needed');
    }

    // Wait for the dashboard to fully render (menu icon signals app shell is ready)
    await this.page.locator('.menu-icon').waitFor({ state: 'visible', timeout: 90000 }).catch(() => {});
    // After session-popup re-login Angular continues loading data in the background.
    // Wait for network to settle so navigateToProducts doesn't start on a loading page.
    await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await this.page.waitForTimeout(3000);
    console.log('Login complete');
  }

  // Assertions
  async expectLoginFieldsVisible() {
    await expect(this.page.locator('input[type="text"], input[type="password"]').first()).toBeVisible();
  }

  async expectLoginFieldsGone() {
    await expect(this.passwordField()).not.toBeVisible({ timeout: 60000 });
  }
}