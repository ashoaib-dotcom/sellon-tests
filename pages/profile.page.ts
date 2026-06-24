import { expect } from '@playwright/test';
import { BasePage } from './base.page';

// Label that appears on the profile button in the top nav bar.
// Captured from codegen recording — update if the test account changes.
const PROFILE_LABEL = 'AashoaibVendor, Aamnas Company';

export class ProfilePage extends BasePage {
  // ── Locators ──────────────────────────────────────────────────────────────

  /** The button in the top nav that opens the profile dropdown. */
  private get profileButton() {
    return this.page.getByText(PROFILE_LABEL).first();
  }

  /** "User settings" item inside the open dropdown. */
  private get userSettingsItem() {
    return this.page.getByText('User settings', { exact: false }).filter({ visible: true }).first();
  }

  /**
   * "Switch theme: Bright" or "Switch theme: Default" item.
   * Pass the full suffix to distinguish the two variants.
   */
  private switchThemeItem(theme: 'Bright' | 'Default') {
    return this.page
      .getByText(`Switch theme: ${theme}`, { exact: false })
      .filter({ visible: true })
      .first();
  }

  /** "Reload navigation menus" item inside the open dropdown. */
  private get reloadNavigationItem() {
    return this.page.getByText('Reload navigation menus', { exact: false }).filter({ visible: true }).first();
  }

  /** "Logout" item inside the open dropdown. */
  private get logoutItem() {
    return this.page.getByText('Logout', { exact: false }).filter({ visible: true }).first();
  }

  /**
   * The close button inside the User settings panel.
   * Tries the specific class first; falls back to any visible close button.
   */
  private get settingsCloseButton() {
    return this.page.locator('.title-button.close-button').filter({ visible: true }).first();
  }

  /** Any currently-visible modal / dialog panel (used to confirm open/closed state). */
  private get settingsPanel() {
    return this.page
      .locator('lb-modal, lb-dialog, [role="dialog"], .settings-panel, [class*="settings"]')
      .filter({ visible: true })
      .first();
  }

  // ── Public methods ────────────────────────────────────────────────────────

  /**
   * Wait for the profile button to be visible and click it to open the dropdown.
   */
  async openProfileDropdown(): Promise<void> {
    await this.profileButton.waitFor({ state: 'visible', timeout: 15000 });
    await this.profileButton.click();
    await this.page.waitForTimeout(800);
  }

  /**
   * Dismiss the profile dropdown by pressing Escape.
   */
  async closeProfileDropdown(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(500);
  }

  /**
   * Open the dropdown then click "User settings" to reveal the settings panel.
   */
  async openUserSettings(): Promise<void> {
    await this.openProfileDropdown();
    await this.userSettingsItem.click({ force: true });
    await this.page.waitForTimeout(2000);
  }

  /**
   * Close the User settings panel via its close button.
   * Falls back to Escape when the close button is not found.
   */
  async closeUserSettings(): Promise<void> {
    const closeBtnVisible = await this.settingsCloseButton
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (closeBtnVisible) {
      await this.settingsCloseButton.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await this.page.waitForTimeout(1500);
  }

  /**
   * Open the dropdown and click the matching "Switch theme: <theme>" item.
   *
   * @param theme - 'Bright' or 'Default'
   */
  async switchTheme(theme: 'Bright' | 'Default'): Promise<void> {
    await this.openProfileDropdown();
    await this.switchThemeItem(theme).click();
    await this.page.waitForTimeout(2000);
  }

  /**
   * Open the dropdown and click "Reload navigation menus".
   */
  async reloadNavigation(): Promise<void> {
    await this.openProfileDropdown();
    await this.reloadNavigationItem.click();
    await this.page.waitForTimeout(3000);
  }

  /**
   * Open the dropdown and click "Logout".
   */
  async logout(): Promise<void> {
    await this.openProfileDropdown();
    await this.logoutItem.click();
    await this.page.waitForTimeout(3000);
  }

  /**
   * Return the current value of the `class` attribute on `<body>`.
   * Useful for detecting theme changes.
   */
  async getThemeClass(): Promise<string | null> {
    return this.page.locator('body').getAttribute('class').catch(() => null);
  }

  /**
   * Return whether the User settings panel (modal / dialog) is currently visible.
   * Useful for conditional logic inside tests (e.g. re-open only when closed).
   */
  async isSettingsPanelVisible(): Promise<boolean> {
    return this.settingsPanel.isVisible({ timeout: 3000 }).catch(() => false);
  }

  // ── Assertion helpers ─────────────────────────────────────────────────────

  /**
   * Assert that all four expected profile menu items are visible.
   * Call this while the dropdown is already open.
   */
  async expectProfileMenuVisible(): Promise<void> {
    const expectedItems = ['User settings', 'Switch theme', 'Reload navigation menus', 'Logout'];
    for (const item of expectedItems) {
      const el = this.page
        .getByText(item, { exact: false })
        .filter({ visible: true })
        .first();
      await expect(el, `"${item}" should be visible in profile dropdown`).toBeVisible({ timeout: 5000 });
    }
  }

  /**
   * Assert that the User settings panel (modal / dialog) is currently open.
   */
  async expectSettingsPanelOpen(): Promise<void> {
    await expect(
      this.settingsPanel,
      'User settings panel should be open',
    ).toBeVisible({ timeout: 5000 });
  }

  /**
   * Assert that the User settings panel (modal / dialog) is no longer visible.
   */
  async expectSettingsPanelClosed(): Promise<void> {
    await expect(
      this.page.locator('lb-modal, lb-dialog, [role="dialog"]').filter({ visible: true }).first(),
      'User settings panel should be closed',
    ).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Assert that the current page is the login page (username field visible).
   * Used to confirm the user was redirected after logout.
   */
  async expectOnLoginPage(): Promise<void> {
    const loginField = this.page.getByRole('textbox', { name: 'Username' });
    await expect(
      loginField,
      'Login page should be displayed (Username field must be visible)',
    ).toBeVisible({ timeout: 10000 });
  }
}
