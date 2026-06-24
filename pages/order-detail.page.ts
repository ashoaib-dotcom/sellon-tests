import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

export class OrderDetailPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ── Tab navigation ──────────────────────────────────────────────────────────

  /**
   * Switch to a tab by name WITHOUT saving first (inspection-only).
   * Returns true if the tab was found and clicked.
   */
  async switchTab(tabName: string): Promise<boolean> {
    const tab = this.page
      .getByText(tabName, { exact: true })
      .filter({ visible: true })
      .first();
    if (await tab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tab.click();
      await this.page.waitForTimeout(2500);
      return true;
    }
    return false;
  }

  /**
   * Save first, then switch to a tab by name.
   * Returns true if the tab was found and clicked.
   */
  async switchTabWithSave(tabName: string): Promise<boolean> {
    await this.save();
    const tab = this.page
      .getByText(tabName, { exact: true })
      .filter({ visible: true })
      .first();
    if (await tab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tab.click();
      await this.page.waitForTimeout(3000);
      console.log(`  Clicked tab: "${tabName}"`);
      return true;
    }
    console.log(`  Tab "${tabName}" not found`);
    return false;
  }

  // ── Ribbon actions ──────────────────────────────────────────────────────────

  /**
   * Click the Save ribbon button (matches "save" or "speichern", case-insensitive).
   */
  async save(): Promise<void> {
    const ribbons = this.page.locator('lb-ribbon-big-button').filter({ visible: true });
    const count = await ribbons.count();
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = (await ribbons.nth(i).textContent() || '').trim();
      labels.push(text);
      if (/save|speichern/i.test(text)) {
        await ribbons.nth(i).click();
        await this.page.waitForTimeout(2000);
        console.log(`  Saved via ribbon: "${text}"`);
        return;
      }
    }
    console.log(`  Save: no save button found. Labels: ${JSON.stringify(labels)}`);
  }

  /**
   * Close the order detail panel.
   * Tries the .close-button first, then falls back to Escape.
   */
  async close(): Promise<void> {
    try {
      const closeBtn = this.page
        .locator('.close-button')
        .filter({ visible: true })
        .first();
      if (await closeBtn.isVisible({ timeout: 2000 })) {
        await closeBtn.click();
        await this.page.waitForTimeout(1500);
        return;
      }
    } catch {}
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(1000);
  }

  /**
   * Get all visible ribbon button labels.
   */
  async getRibbonButtons(): Promise<string[]> {
    const ribbons = this.page.locator('lb-ribbon-big-button').filter({ visible: true });
    const count = await ribbons.count();
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = (await ribbons.nth(i).textContent() || '').trim();
      if (text) labels.push(text);
    }
    return labels;
  }

  /**
   * Click the first ribbon button whose text matches the given pattern.
   */
  async clickRibbonButton(pattern: RegExp): Promise<void> {
    const ribbons = this.page.locator('lb-ribbon-big-button').filter({ visible: true });
    const count = await ribbons.count();
    for (let i = 0; i < count; i++) {
      const text = (await ribbons.nth(i).textContent() || '').trim();
      if (pattern.test(text)) {
        await ribbons.nth(i).click();
        await this.page.waitForTimeout(2000);
        console.log(`  Clicked ribbon: "${text}"`);
        return;
      }
    }
    console.log(`  No ribbon button matched: ${pattern}`);
  }

  /**
   * Check whether a ribbon button matching the pattern is visible.
   */
  async isRibbonButtonVisible(pattern: RegExp): Promise<boolean> {
    const ribbons = this.page.locator('lb-ribbon-big-button').filter({ visible: true });
    const count = await ribbons.count();
    for (let i = 0; i < count; i++) {
      const text = (await ribbons.nth(i).textContent() || '').trim();
      if (pattern.test(text)) return true;
    }
    return false;
  }

  /**
   * Collapse the ribbon toolbar.
   */
  async clickCollapseRibbon(): Promise<void> {
    const btn = this.page
      .locator('[aria-label*="collapse" i], [title*="collapse" i], .ribbon-collapse')
      .filter({ visible: true })
      .first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Expand the ribbon toolbar.
   */
  async clickExpandRibbon(): Promise<void> {
    const btn = this.page
      .locator('[aria-label*="expand" i], [title*="expand" i], .ribbon-expand')
      .filter({ visible: true })
      .first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      await this.page.waitForTimeout(500);
    }
  }

  // ── Order items tab ─────────────────────────────────────────────────────────

  /**
   * Count order line items on the Order items tab (must already be open).
   * For New orders counts "Confirm position" buttons; for Confirmed orders
   * counts non-empty tbody rows.
   */
  async countItemsOnOrderItemsTab(): Promise<number> {
    const confirmBtns = this.page
      .getByRole('button', { name: /confirm position/i })
      .filter({ visible: true });
    const btnCount = await confirmBtns.count();
    if (btnCount > 0) return btnCount;

    const rows = this.page.locator('tbody tr');
    const rowCount = await rows.count();
    let count = 0;
    for (let i = 0; i < rowCount; i++) {
      const text = (await rows.nth(i).textContent() || '').trim();
      if (text.length > 5) count++;
    }
    return count;
  }

  /**
   * Click the "Confirm position" button.
   * @param index - which button to click (0-based, default 0).
   */
  /** Double-click the nth row (default 0) to open order detail. */
  async openRow(index = 0): Promise<void> {
    const rows = this.page.locator('tbody tr');
    await rows.nth(index).dblclick();
    await this.page.waitForTimeout(4000);
  }

  /** Return a locator for all currently-visible input elements on the page. */
  getVisibleInputs() {
    return this.page.locator('input').filter({ visible: true });
  }

  /** Return true if lb-modal is currently visible on the page. */
  async isModalVisible(): Promise<boolean> {
    return this.page.locator('lb-modal').isVisible().catch(() => false);
  }

  /** Return text of all currently-visible tab labels. */
  async getAvailableTabs(): Promise<string[]> {
    const texts = await this.page
      .locator('[role="tab"], .tab, lb-tab')
      .filter({ visible: true })
      .allTextContents();
    return texts.map(t => t.trim()).filter(Boolean);
  }

  /** Return `{ visible, disabled }` state of the "Create new shipment" ribbon button. */
  async getCreateShipmentButtonState(): Promise<{ visible: boolean; disabled: boolean }> {
    const btn = this.page
      .locator('lb-ribbon-big-button')
      .filter({ hasText: /create new shipment|new shipment/i })
      .filter({ visible: true })
      .first();
    const visible  = await btn.isVisible({ timeout: 3000 }).catch(() => false);
    const disabled = visible ? await btn.isDisabled({ timeout: 2000 }).catch(() => false) : false;
    return { visible, disabled };
  }

  async clickConfirmPosition(index = 0): Promise<void> {
    const btn = this.page
      .getByRole('button', { name: /confirm position/i })
      .filter({ visible: true })
      .nth(index);
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      if (await btn.isEnabled({ timeout: 1000 }).catch(() => false)) {
        await btn.click();
        await this.page.waitForTimeout(1500);
        console.log(`  Confirmed position[${index}]`);
      } else {
        console.log(`  Confirm position[${index}] is disabled`);
      }
    } else {
      console.log(`  Confirm position[${index}] not visible`);
    }
  }

  /**
   * Edit the first editable numeric quantity input found on the page.
   * @param value - string value to fill in.
   */
  async editQuantity(value: string): Promise<void> {
    const allInputs = this.page.locator('input').filter({ visible: true });
    const inputCount = await allInputs.count();
    for (let i = 0; i < inputCount; i++) {
      const readonly = await allInputs.nth(i).getAttribute('readonly').catch(() => null);
      const disabled = await allInputs.nth(i).getAttribute('disabled').catch(() => null);
      const val = await allInputs.nth(i).inputValue().catch(() => '');
      const numVal = parseInt(val);
      if (!isNaN(numVal) && readonly === null && disabled === null) {
        await allInputs.nth(i).fill(value);
        await this.page.waitForTimeout(500);
        console.log(`  Quantity set to ${value}`);
        return;
      }
    }
    console.log(`  editQuantity: no suitable input found`);
  }

  // ── Shipment modal ──────────────────────────────────────────────────────────

  /**
   * Click the "Create new shipment" ribbon button or fallback button.
   * Returns true if the button was found and clicked.
   */
  async clickCreateNewShipment(): Promise<boolean> {
    const createBtn = this.page
      .locator('lb-ribbon-big-button')
      .filter({ hasText: /create new shipment|new shipment/i })
      .filter({ visible: true })
      .first();
    const fallbackBtn = this.page
      .getByRole('button', { name: /create new shipment/i })
      .filter({ visible: true })
      .first();

    const useRibbon = await createBtn.isVisible({ timeout: 3000 }).catch(() => false);
    const btnToClick = useRibbon ? createBtn : fallbackBtn;

    if (!await btnToClick.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('"Create new shipment" button not found');
      return false;
    }
    await btnToClick.click();
    await this.page.waitForTimeout(3000);
    return true;
  }

  /**
   * Get the currently visible modal/dialog locator.
   */
  getModal(): Locator {
    return this.page
      .locator('lb-modal, lb-dialog, [role="dialog"]')
      .filter({ visible: true })
      .first();
  }

  /**
   * Open a combobox inside the given modal and select the first available option.
   * @param modal  - the modal locator to search within.
   * @param index  - which lb-combobox to target (0-based).
   */
  async selectCombobox(modal: Locator, index: number): Promise<boolean> {
    const combo = modal.locator('lb-combobox').filter({ visible: true }).nth(index);
    if (await combo.count() === 0) return false;

    const comboInput = combo.locator('input').first();
    if (await comboInput.count() > 0) {
      await comboInput.click({ force: true });
      await this.page.waitForTimeout(2500);
      const opts = this.page
        .locator('lb-option, .lb-option, [class*="lb-option"], .dropdown-item, [role="option"]')
        .filter({ visible: true });
      if (await opts.count() > 0) {
        await opts.first().click();
        await this.page.waitForTimeout(600);
        console.log(`  combo[${index}]: selected via input click`);
        return true;
      }
    }

    const buttons = await combo.locator('button').all();
    if (buttons.length > 0) {
      await buttons[buttons.length - 1].click({ force: true });
      await this.page.waitForTimeout(2500);
      const opts = this.page
        .locator('lb-option, .lb-option, [class*="lb-option"], .dropdown-item, [role="option"]')
        .filter({ visible: true });
      if (await opts.count() > 0) {
        await opts.first().click();
        await this.page.waitForTimeout(600);
        console.log(`  combo[${index}]: selected via last button`);
        return true;
      }
    }

    await combo.click({ force: true });
    await this.page.waitForTimeout(2500);
    const opts3 = this.page
      .locator('lb-option, .lb-option, [class*="lb-option"], .dropdown-item, [role="option"]')
      .filter({ visible: true });
    if (await opts3.count() > 0) {
      await opts3.first().click();
      await this.page.waitForTimeout(600);
      console.log(`  combo[${index}]: selected via container click`);
      return true;
    }

    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
    console.log(`  combo[${index}]: no options found`);
    return false;
  }

  /**
   * Fill the shipment number field inside the modal.
   * Targets the first standalone text input (not inside a combobox).
   */
  async fillShipmentNumber(modal: Locator, value: string): Promise<void> {
    const standaloneInputs = await this._getStandaloneTextInputs(modal);
    if (standaloneInputs.length > 0) {
      await standaloneInputs[0].fill(value);
      await this.page.waitForTimeout(300);
      console.log(`  Shipment number set: "${value}"`);
    } else {
      console.log(`  fillShipmentNumber: no standalone inputs found`);
    }
  }

  /**
   * Fill the delivery note number field inside the modal.
   * Targets the second standalone text input (not inside a combobox).
   */
  async fillDeliveryNoteNumber(modal: Locator, value: string): Promise<void> {
    const standaloneInputs = await this._getStandaloneTextInputs(modal);
    if (standaloneInputs.length > 1) {
      await standaloneInputs[1].fill(value);
      await this.page.waitForTimeout(300);
      console.log(`  Delivery note number set: "${value}"`);
    } else {
      console.log(`  fillDeliveryNoteNumber: fewer than 2 standalone inputs found`);
    }
  }

  /**
   * Check all item checkboxes inside the shipment modal that are not yet checked.
   */
  async checkItemCheckboxes(modal: Locator): Promise<void> {
    const checkboxes = modal.locator('input[type="checkbox"]').filter({ visible: true });
    for (let i = 0; i < await checkboxes.count(); i++) {
      if (!await checkboxes.nth(i).isChecked().catch(() => false)) {
        await checkboxes.nth(i).click({ force: true });
        await this.page.waitForTimeout(400);
        console.log(`  Checked checkbox[${i}]`);
      }
    }
    const lbCbs = modal.locator('lb-checkbox').filter({ visible: true });
    for (let i = 0; i < await lbCbs.count(); i++) {
      await lbCbs.nth(i).click({ force: true });
      await this.page.waitForTimeout(400);
    }
    await this.page.waitForTimeout(1000);
  }

  /**
   * Click the "Add shipment" button inside the modal if it is enabled.
   * Falls back to dismissing the modal if it is disabled or not found.
   */
  async clickAddShipment(modal: Locator): Promise<void> {
    const addBtn = modal
      .getByRole('button', { name: /add shipment/i })
      .filter({ visible: true })
      .first();
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const enabled = await addBtn.isEnabled().catch(() => false);
      console.log(`"Add shipment" enabled: ${enabled}`);
      if (enabled) {
        await addBtn.click();
        await this.page.waitForTimeout(4000);
        console.log('Clicked "Add shipment"');
      } else {
        console.log('"Add shipment" disabled — dismissing modal');
        await this.dismissModal(modal);
      }
    } else {
      console.log('"Add shipment" button not found');
      await this.dismissModal(modal);
    }
  }

  /**
   * Return true when the "Add shipment" button inside the modal is disabled.
   */
  async isAddShipmentDisabled(modal: Locator): Promise<boolean> {
    const addBtn = modal
      .getByRole('button', { name: /add shipment/i })
      .filter({ visible: true })
      .first();
    return addBtn.isDisabled({ timeout: 2000 }).catch(() => true);
  }

  /**
   * Dismiss / close a modal.
   * Tries the modal's own close button, then falls back to Escape.
   */
  async dismissModal(modal: Locator): Promise<void> {
    const closeBtn = modal
      .locator('.close-button, [aria-label="Close"], [aria-label="close"]')
      .filter({ visible: true })
      .first();
    if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeBtn.click();
      await this.page.waitForTimeout(1000);
      return;
    }
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(1500);
  }

  /**
   * Wait for the lb-modal to disappear; if it lingers, press Escape.
   */
  async waitForModalToClose(timeoutMs = 10000): Promise<void> {
    await this.page
      .locator('lb-modal')
      .waitFor({ state: 'hidden', timeout: timeoutMs })
      .catch(async () => {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(1000);
      });
    await this.page.waitForTimeout(2000);
  }

  // ── Date input ──────────────────────────────────────────────────────────────

  /**
   * Fill a date input field found on the current page.
   * Tries ISO format first (YYYY-MM-DD), then European sequential entry (DD.MM.YYYY).
   * @param isoDate - date in YYYY-MM-DD format.
   */
  async setDateInput(isoDate: string): Promise<boolean> {
    const dateInput = this.page
      .locator('input[type="date"], lb-datepicker input, [class*="date"] input')
      .filter({ visible: true })
      .first();

    await dateInput.fill(isoDate);
    await this.page.waitForTimeout(300);
    const val = await dateInput.inputValue().catch(() => '');
    if (val) {
      console.log(`  Date set (ISO): ${val}`);
      return true;
    }

    const [yyyy, mm, dd] = isoDate.split('-');
    await dateInput.click();
    await dateInput.pressSequentially(`${dd}.${mm}.${yyyy}`);
    await this.page.waitForTimeout(300);
    const val2 = await dateInput.inputValue().catch(() => '');
    if (val2) {
      console.log(`  Date set (EU sequential): ${val2}`);
      return true;
    }

    console.log(`  Could not set date on input`);
    return false;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Return all text inputs inside the modal that are NOT inside a lb-combobox.
   */
  private async _getStandaloneTextInputs(modal: Locator): Promise<Locator[]> {
    const allInputs = modal
      .locator('input[type="text"], input:not([type])')
      .filter({ visible: true });
    const inputCount = await allInputs.count();
    const result: Locator[] = [];
    for (let i = 0; i < inputCount; i++) {
      const insideCombo = await allInputs.nth(i).evaluate(
        (el) => !!el.closest('lb-combobox'),
      );
      if (!insideCombo) result.push(allInputs.nth(i));
    }
    return result;
  }
}
