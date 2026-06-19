import { Page, expect } from '@playwright/test';
import { RIBBON, PRODUCT_STATE, COLUMN, DIALOG } from '../helpers/selectors';

export { RIBBON, PRODUCT_STATE, COLUMN, DIALOG };

export class ProductListPage {
  constructor(private page: Page) {}

  // ── Ribbon button locators ─────────────────────────────────────────────────
  newBtn    = () => this.page.getByText(RIBBON.NEW,    { exact: true }).filter({ visible: true }).first();
  deleteBtn = () => this.page.getByText(RIBBON.DELETE, { exact: true }).filter({ visible: true }).first();
  exportBtn = () => this.page.getByText(RIBBON.EXPORT, { exact: true }).filter({ visible: true }).first();
  refreshBtn= () => this.page.getByText(RIBBON.REFRESH,{ exact: true }).filter({ visible: true }).first();
  importBtn = () => this.page.getByText(RIBBON.IMPORT, { exact: true }).filter({ visible: true }).first();
  clearBtn  = () => this.page.getByText(RIBBON.CLEAR,  { exact: true }).filter({ visible: true }).first();
  searchBtn = () => this.page.getByText(RIBBON.SEARCH, { exact: true }).filter({ visible: true }).first();

  async ribbonButtonsVisible(): Promise<Record<string, boolean>> {
    return {
      [RIBBON.NEW]:    await this.newBtn().isVisible({ timeout: 2000 }).catch(() => false),
      [RIBBON.DELETE]: await this.deleteBtn().isVisible({ timeout: 2000 }).catch(() => false),
      [RIBBON.EXPORT]: await this.exportBtn().isVisible({ timeout: 2000 }).catch(() => false),
      [RIBBON.REFRESH]:await this.refreshBtn().isVisible({ timeout: 2000 }).catch(() => false),
    };
  }

  async clickNew() {
    await this.newBtn().dispatchEvent('click');
    await this.page.waitForTimeout(10000);
  }

  async clickImport() {
    await this.importBtn().click();
    await this.page.waitForTimeout(10000);
  }

  async clickRefresh() {
    await this.refreshBtn().click();
    await this.page.waitForTimeout(10000);
  }

  async clickClear() {
    await this.clearBtn().click();
    await this.page.waitForTimeout(3000);
  }

  async getPaginationText() {
    return await this.page.locator('text=/\\d+ - \\d+ of \\d+/').innerText();
  }

  async getRowCount() {
    return await this.page.locator('tbody tr').count();
  }

  async doubleClickProduct(productText: string) {
    const row = this.page.locator('tr').filter({ hasText: productText }).first();
    await row.dblclick();
    await this.page.waitForTimeout(10000);
  }

  async doubleClickFirstProduct() {
    const row = this.page.locator('tbody tr').first();
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.dblclick();
    await this.page.waitForTimeout(10000);
  }

  async clickProductRow(productText: string) {
    const row = this.page.locator('tbody tr').filter({ hasText: productText }).first();
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await this.page.waitForTimeout(10000);
  }

  async clickFirstProductRow() {
    const row = this.page.locator('tbody tr').first();
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await this.page.waitForTimeout(10000);
  }

  async expectTableVisible() {
    await expect(this.page.getByTitle('ID', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(this.page.getByTitle('Category', { exact: true })).toBeVisible();
    await expect(this.page.getByTitle('Name', { exact: true })).toBeVisible();
    await expect(this.page.getByTitle('Price', { exact: true })).toBeVisible();
  }

  async expectToolbarVisible() {
    await expect(this.page.getByText('Refresh', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(this.page.getByText('Search', { exact: true })).toBeVisible();
    await expect(this.page.getByText('Filter and sorting', { exact: true })).toBeVisible();
    await expect(this.page.getByText('Mass edit', { exact: true })).toBeVisible();
    await expect(this.page.getByText('Stock import', { exact: true })).toBeVisible();
  }

  async expectColumnHeaders() {
    await expect(this.page.getByTitle('ID', { exact: true })).toBeVisible();
    await expect(this.page.getByTitle('Category', { exact: true })).toBeVisible();
    await expect(this.page.getByTitle('GTIN', { exact: true })).toBeVisible();
    await expect(this.page.getByTitle('Name', { exact: true })).toBeVisible();
    await expect(this.page.getByTitle('Price', { exact: true })).toBeVisible();
    await expect(this.page.getByTitle('Vat', { exact: true })).toBeVisible();
  }

  // Click the Delete toolbar button
  async clickDelete() {
    await this.deleteBtn().click();
    await this.page.waitForTimeout(2000);
  }

  // Select a row by its index (0-based) via its checkbox / first cell
  async selectRowByIndex(index: number) {
    const row = this.page.locator('tbody tr').nth(index);
    await expect(row).toBeVisible({ timeout: 15000 });
    // Try clicking the checkbox in the first cell
    const checkbox = row.locator('input[type="checkbox"]').first();
    if (await checkbox.count() > 0) {
      await checkbox.click();
    } else {
      await row.locator('td').first().click();
    }
    await this.page.waitForTimeout(500);
  }

  // Confirm a delete/confirmation dialog by clicking Yes/OK/Confirm
  async confirmDialog() {
    const confirmBtn = this.page
      .getByRole('button', { name: new RegExp(`^(${DIALOG.YES}|${DIALOG.OK}|${DIALOG.CONFIRM}|${DIALOG.DELETE})$`, 'i') })
      .first();
    await confirmBtn.waitFor({ state: 'visible', timeout: 10000 });
    await confirmBtn.click();
    await this.page.waitForTimeout(5000);
  }

  // Dismiss a dialog (No / Cancel)
  async dismissDialog() {
    const cancelBtn = this.page
      .getByRole('button', { name: new RegExp(`^(${DIALOG.NO}|${DIALOG.CANCEL}|${DIALOG.CLOSE})$`, 'i') })
      .first();
    await cancelBtn.waitFor({ state: 'visible', timeout: 5000 });
    await cancelBtn.click();
    await this.page.waitForTimeout(1000);
  }

  // Get total product count from pagination text (e.g. "1 - 50 of 108" → 108)
  async getTotalProductCount(): Promise<number> {
    const text = await this.page.locator('text=/\\d+ - \\d+ of \\d+/').innerText();
    const match = text.match(/of (\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  // Select the first visible row that contains the given status text (e.g. 'Stage 1', 'Error')
  // Returns the provider key text of the selected row, or null if none found
  async selectFirstProductByStatus(status: string): Promise<string | null> {
    const row = this.page.locator('tbody tr').filter({ hasText: status }).first();
    if (await row.count() === 0) return null;

    // Get identifier (provider key is typically in the row)
    const rowText = await row.innerText();

    const checkbox = row.locator('input[type="checkbox"]').first();
    if (await checkbox.count() > 0) {
      await checkbox.click();
    } else {
      await row.locator('td').first().click();
    }
    await this.page.waitForTimeout(500);
    return rowText.trim().split('\n')[0] || rowText.trim().substring(0, 30);
  }

  // Click the select-all checkbox in the table header
  async selectAllProducts() {
    const headerCheckbox = this.page.locator('thead input[type="checkbox"], th input[type="checkbox"]').first();
    if (await headerCheckbox.count() > 0) {
      await headerCheckbox.click();
    } else {
      // Fallback: click the first cell in the header row
      await this.page.locator('thead tr th').first().click();
    }
    await this.page.waitForTimeout(1000);
  }

  // Verify a product (by partial text) does NOT appear anywhere in the visible table
  async verifyProductNotInList(text: string): Promise<boolean> {
    await this.page.waitForTimeout(2000);
    const rows = this.page.locator('tbody tr').filter({ hasText: text });
    return await rows.count() === 0;
  }

  // Verify a product (by partial text) DOES appear in the visible table
  async verifyProductInList(text: string): Promise<boolean> {
    await this.page.waitForTimeout(1000);
    const rows = this.page.locator('tbody tr').filter({ hasText: text });
    return await rows.count() > 0;
  }

  // Get the provider key value from a specific row (0-based index)
  async getProviderKeyFromRow(index: number): Promise<string> {
    const row = this.page.locator('tbody tr').nth(index);
    // Provider key column — search for the cell that looks like a SKU
    const cells = await row.locator('td').allInnerTexts();
    return cells.find(c => c.trim().length > 0 && c.includes('-')) || cells[index] || '';
  }

  async expectPaginationVisible() {
    await expect(this.page.locator('text=/\\d+ - \\d+ of \\d+/')).toBeVisible({ timeout: 15000 });
    await expect(this.page.getByText('Lines/page')).toBeVisible();
    await expect(this.page.getByText('Page', { exact: true })).toBeVisible();
  }
}