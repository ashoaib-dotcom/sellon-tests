import { Page, expect } from '@playwright/test';

export class LoginPage {
  constructor(private page: Page) {}

  // Locators
  private usernameField = () => this.page.getByRole('textbox', { name: 'Username' });
  private passwordField = () => this.page.getByRole('textbox', { name: 'Password' });
  private loginButton = () => this.page.getByRole('button', { name: 'Login' });
  private sessionYesButton = () => this.page.getByRole('button', { name: 'Yes' });

  // Actions
  async goto() {
    await this.page.goto('https://mpe-test.lobster-cloud.com', { timeout: 120000 });
    await this.page.waitForSelector('input', { state: 'visible', timeout: 120000 });
    await this.page.waitForTimeout(5000);
  }

  async fillUsername(username: string) {
    await this.usernameField().click();
    await this.usernameField().pressSequentially(username, { delay: 150 });
    await this.page.waitForTimeout(1000);
  }

  async fillPassword(password: string) {
    await this.passwordField().click();
    await this.passwordField().pressSequentially(password, { delay: 150 });
    await this.page.waitForTimeout(1000);

    // Retry if password field is empty
    const value = await this.passwordField().inputValue();
    if (value === '') {
      await this.passwordField().click();
      await this.passwordField().pressSequentially(password, { delay: 200 });
      await this.page.waitForTimeout(1000);
    }
  }

  async clickLogin() {
    await this.loginButton().click();
  }

  async handleSessionPopup() {
    try {
      await this.sessionYesButton().waitFor({ state: 'visible', timeout: 15000 });
      await this.sessionYesButton().click();
      console.log('Session popup handled');
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
    await this.page.waitForTimeout(60000);
  }

  // Assertions
  async expectLoginFieldsVisible() {
    await expect(this.usernameField()).toBeVisible();
    await expect(this.passwordField()).toBeVisible();
    await expect(this.loginButton()).toBeVisible();
  }

  async expectLoginFieldsGone() {
    await expect(this.usernameField()).not.toBeVisible({ timeout: 60000 });
  }
}