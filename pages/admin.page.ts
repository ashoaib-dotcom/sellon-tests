import { Page, Locator } from '@playwright/test';

export class AdminPage {
  constructor(private page: Page) {}

  async login(adminUrl: string, username: string, password: string) {
    const loginSelector = [
      'input[name="username"]',
      'input[id*="user" i]',
      'input[placeholder*="user" i]',
      'input[type="text"]',
      'input[type="password"]',
    ].join(', ');

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[Admin] Loading login page (attempt ${attempt})...`);
        await this.page.goto(adminUrl, { timeout: 120000, waitUntil: 'domcontentloaded' });
        await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
        await this.page.waitForSelector(loginSelector, { state: 'visible', timeout: 90000 });
        await this.page.waitForTimeout(3000);
        console.log('[Admin] Login page loaded');
        break;
      } catch (err) {
        console.log(`[Admin] Attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`);
        if (attempt < 3) {
          console.log('[Admin] Retrying in 10 seconds...');
          await this.page.waitForTimeout(10000);
        }
      }
    }

    const usernameField = this.page.getByRole('textbox', { name: 'Username' });
    await usernameField.waitFor({ state: 'visible', timeout: 30000 });
    await usernameField.click();
    await usernameField.pressSequentially(username, { delay: 150 });
    await this.page.waitForTimeout(500);

    const passwordField = this.page.getByRole('textbox', { name: 'Password' });
    await passwordField.click();
    await passwordField.pressSequentially(password, { delay: 150 });
    await this.page.waitForTimeout(500);

    await this.page.getByRole('button', { name: 'Login' }).click();

    await this.page.locator('loginwindow').waitFor({ state: 'hidden', timeout: 90000 })
      .catch(() => console.log('[Admin] loginwindow did not hide — continuing anyway'));

    const yesBtn = this.page.getByRole('button', { name: 'Yes' });
    if (await yesBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await yesBtn.click();
      await this.page.locator('loginwindow').waitFor({ state: 'hidden', timeout: 60000 })
        .catch(() => console.log('[Admin] loginwindow still visible after Yes — continuing'));
    }

    await this.page.locator('.menubar-item').first()
      .waitFor({ state: 'visible', timeout: 60000 })
      .catch(() => console.log('[Admin] App shell (.menubar-item) not found after login'));

    await this.page.waitForTimeout(3000);
    const lwStillVisible = await this.page.locator('loginwindow').isVisible().catch(() => false);
    if (lwStillVisible) {
      console.log('[Admin] loginwindow still in DOM after settle — waiting extra 10s');
      await this.page.locator('loginwindow').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }

    console.log('[Admin] Login complete');
  }

  async isAppShellVisible(): Promise<boolean> {
    return this.page.locator('.menubar-item, .menu-icon').first()
      .isVisible({ timeout: 10000 }).catch(() => false);
  }

  async isLoginFormVisible(): Promise<boolean> {
    return this.page.getByRole('button', { name: 'Login' })
      .isVisible({ timeout: 2000 }).catch(() => false);
  }

  async openSearchBar() {
    await this.page.locator('loginwindow').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const selectors = [
      '.menubar-item.search-btn',
      '.fa-search',
      '.fal.fa-search',
      '.fas.fa-search',
    ];

    for (const sel of selectors) {
      const el = this.page.locator(sel).filter({ visible: true }).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.click({ force: true });
        await this.page.waitForTimeout(1000);
        console.log(`[Admin] Search bar opened via: ${sel}`);
        return;
      }
    }

    const farIcons = this.page.locator('.fal').filter({ visible: true });
    const count = await farIcons.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const cls = await farIcons.nth(i).getAttribute('class').catch(() => '');
      if (!cls?.includes('fa-language')) {
        await farIcons.nth(i).click({ force: true });
        await this.page.waitForTimeout(1000);
        console.log(`[Admin] Search bar opened via .fal[${i}] class="${cls}"`);
        return;
      }
    }

    await this.page.keyboard.press('Control+Shift+F');
    await this.page.waitForTimeout(1000);
    console.log('[Admin] Search bar opened via keyboard shortcut Control+Shift+F');
  }

  async searchAndOpen(term: string, exactLabel: string): Promise<boolean> {
    const searchBox = this.page.getByRole('textbox', { name: /CMD.*Shift.*F/i });
    const appeared = await searchBox.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    if (!appeared) {
      console.log('[Admin] Search bar textbox did not appear — skipping');
      return false;
    }
    await searchBox.fill('');
    await searchBox.click();
    await searchBox.pressSequentially(term, { delay: 150 });
    await this.page.waitForTimeout(2000);

    const menuItems = this.page.locator('div.menu-item').filter({
      has: this.page.locator('span.label', { hasText: exactLabel }),
    }).filter({ visible: true });
    const itemCount = await menuItems.count();
    const menuItem  = menuItems.nth(Math.max(0, itemCount - 1));

    const openLink  = menuItem.locator('div.open a, .widget-footer a, a').first();
    const exactMatch = (await openLink.isVisible({ timeout: 1000 }).catch(() => false))
      ? openLink
      : menuItem;
    if (await exactMatch.isVisible({ timeout: 3000 }).catch(() => false)) {
      await exactMatch.click();
      console.log(`[Admin] Clicked search result: "${exactLabel}"`);
      await this.page.waitForTimeout(3000);
      return true;
    }

    const containerSelectors = ['lb-list-row', 'lb-search-result', '.search-result', '.caption .heading'];
    for (const sel of containerSelectors) {
      const items = this.page.locator(sel).filter({ hasText: exactLabel }).filter({ visible: true });
      if (await items.count() > 0) {
        await items.first().click();
        console.log(`[Admin] Clicked "${exactLabel}" via ${sel}`);
        await this.page.waitForTimeout(3000);
        return true;
      }
    }

    console.log(`[Admin] WARNING: could not find "${exactLabel}" in search results — skipping`);
    return false;
  }

  async setColumnFilter(colIndex: number, value: string): Promise<boolean> {
    const input = this.page.locator('thead tr').nth(1)
      .locator('th, td').nth(colIndex)
      .locator('input[type="text"], input:not([type])').first();

    if (!await input.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log(`[Admin] No filter input at column ${colIndex}`);
      return false;
    }
    await input.clear();
    await input.fill(value);
    await this.page.waitForTimeout(600);
    return true;
  }

  async clickSearch() {
    const btn = this.page.getByText('Search', { exact: true }).filter({ visible: true }).first();
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click();
      await this.page.waitForTimeout(3000);
    } else {
      await this.page.waitForTimeout(2000);
    }
  }

  async clickClear() {
    const btn = this.page.getByText('Clear', { exact: true }).filter({ visible: true }).first();
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click();
      await this.page.waitForTimeout(2000);
    }
  }

  async waitForGrid() {
    await this.page.locator('thead tr th, thead tr td').first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => console.log('[Admin] thead not found within 15s'));
    await this.page.waitForTimeout(1000);
  }

  async getColumnHeaders(): Promise<string[]> {
    return this.page.locator('thead tr').first().locator('th, td').allInnerTexts();
  }

  getRowsContaining(text: string): Locator {
    return this.page.locator('tbody tr').filter({ hasText: text });
  }

  async selectSafeRows(filterText: string, safeTerms: string[]): Promise<number> {
    const rows = this.getRowsContaining(filterText);
    const rowCount = await rows.count();
    let selectedCount = 0;
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const rowText = await row.innerText();
      const isSafe = safeTerms.some(term => rowText.includes(term));
      if (!isSafe) {
        console.log(`  SKIPPED — row does not match safe terms: ${safeTerms.join(', ')}`);
        continue;
      }
      const checkbox = row.locator('input[type="checkbox"], .item-selector').first();
      if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
        await checkbox.check({ force: true });
        selectedCount++;
      }
    }
    return selectedCount;
  }

  getDeleteButton(): Locator {
    return this.page.locator('lb-ribbon-big-button').filter({ hasText: 'Delete' }).filter({ visible: true }).first();
  }

  getConfirmYesButton(): Locator {
    return this.page.getByRole('button', { name: 'Yes' }).filter({ visible: true }).first();
  }

  getTrashOrDeleteButton(): Locator {
    return this.page.locator('.fal.fa-trash, lb-ribbon-big-button:has-text("Delete")')
      .filter({ visible: true }).first();
  }

  getProfileButton(adminName: string): Locator {
    return this.page.locator('.menubar-item').last()
      .or(this.page.getByText(adminName, { exact: false }).first());
  }

  getLogoutButton(): Locator {
    return this.page.getByText('Logout', { exact: true }).filter({ visible: true }).first();
  }
}
