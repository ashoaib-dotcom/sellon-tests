import { Page, expect } from '@playwright/test';
import { BasePage } from './base.page';
import { RIBBON, ORDER_STATUS, COLUMN, DIALOG } from '../helpers/selectors';

export { RIBBON, ORDER_STATUS, COLUMN, DIALOG };

export class OrdersPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigateToOrders() {
    try {
      const modal = this.page.locator('lb-modal.blocking');
      if (await modal.isVisible()) await this.pressEscape();
    } catch {}

    // Open sidebar (.menubar-item confirmed by codegen)
    await this.page.locator('.menubar-item, .menu-icon').first().click();
    await this.waitForLoad(2);

    // Expand Orders parent (click first nav "Orders" item)
    const navOrders = this.page.getByRole('navigation').getByText('Orders', { exact: true });
    const subVisible = this.page.getByTitle('Orders');
    if (await subVisible.count() < 2) {
      await navOrders.first().click({ force: true });
      await this.waitForLoad(2);
    }

    // Click the Orders sub-item (getByTitle confirmed by codegen)
    await this.page.getByTitle('Orders').nth(1).click();
    await this.waitForLoad(15);

    await this.pressEscape();
  }

  async expectOrderTableVisible() {
    await expect(this.page.getByTitle('ID', { exact: true })).toBeVisible({ timeout: 30000 });
  }

  async getRowCount() {
    return await this.page.locator('tbody tr').count();
  }

  async getPaginationText() {
    try {
      return await this.page.locator('text=/\\d+ - \\d+ of \\d+/').innerText({ timeout: 5000 });
    } catch {
      return 'N/A';
    }
  }

  async getPaginationTotal(): Promise<number> {
    const text = await this.getPaginationText();
    const m = text.match(/of (\d+)/);
    return m ? parseInt(m[1]) : 0;
  }

  // Returns the filter row cell for a given column index
  filterCell(colIndex: number) {
    return this.page.locator('thead tr').nth(1).locator('th, td').nth(colIndex);
  }

  // Returns the number of cells in the filter row (second thead row)
  async getFilterRowCellCount(): Promise<number> {
    return await this.page.locator('thead tr').nth(1).locator('th, td').count();
  }

  // Returns true if the filter row cell at colIndex contains a text input
  async filterCellHasTextInput(colIndex: number): Promise<boolean> {
    const input = this.filterCell(colIndex).locator('input[type="text"], input:not([type])').first();
    return (await input.count()) > 0;
  }

  // Returns all inner texts from the filter row cells
  async getFilterRowTexts(): Promise<string[]> {
    return await this.page.locator('thead tr').nth(1).locator('th, td').allInnerTexts();
  }

  // Returns all column header titles from the first thead row
  async getColumnHeaders(): Promise<string[]> {
    const headers = await this.page.locator('thead tr').first().locator('th, td').allInnerTexts();
    return headers.map(h => h.trim().replace(/\n.*/, ''));
  }

  // Find the column index by header title text (case-insensitive partial match)
  async findColumnIndex(titleText: string): Promise<number> {
    const headers = await this.getColumnHeaders();
    const idx = headers.findIndex(h => h.toLowerCase().includes(titleText.toLowerCase()));
    return idx;
  }

  // Set a text filter on a specific column
  async setTextFilter(colIndex: number, value: string) {
    const cell = this.filterCell(colIndex);
    const input = cell.locator('input[type="text"], input:not([type])').first();
    if (await input.count() === 0) {
      console.log(`  No text input found in filter col ${colIndex}`);
      return;
    }
    await input.clear();
    await input.fill(value);
    await this.page.waitForTimeout(400);
    console.log(`  Text filter col ${colIndex} = "${value}"`);
  }

  // Open a dropdown filter and pick an option (Lobster lb-combobox)
  async setDropdownFilter(colIndex: number, optionText: string) {
    const cell = this.filterCell(colIndex);

    // Native <select>
    const nativeSelect = cell.locator('select').first();
    if (await nativeSelect.count() > 0) {
      try {
        await nativeSelect.selectOption({ label: optionText });
        await this.page.waitForTimeout(400);
        console.log(`  Dropdown col ${colIndex} = "${optionText}" via native select`);
        return;
      } catch {}
    }

    // Lobster lb-combobox — click arrow button only (not the input, to avoid toggle)
    const combobox = cell.locator('lb-combobox').first();
    if (await combobox.count() > 0) {
      const arrowBtn = combobox.locator('button.form-button, button:has(.fa-sort-down)').first();
      if (await arrowBtn.count() > 0) {
        await arrowBtn.click();
      } else {
        await combobox.click();
      }
      await this.page.waitForTimeout(1200);
    } else {
      await cell.click();
      await this.page.waitForTimeout(1000);
    }

    // Find option in Lobster dropdown
    const optionSelectors = [
      `.dropdown-item:has-text("${optionText}")`,
      `[class*="dropdown-item"]:has-text("${optionText}")`,
      `.item-label:has-text("${optionText}")`,
      `[class*="item-label"]:has-text("${optionText}")`,
      `lb-option:has-text("${optionText}")`,
      `[role="option"]:has-text("${optionText}")`,
    ];

    for (const sel of optionSelectors) {
      const opt = this.page.locator(sel).first();
      if (await opt.count() > 0) {
        await opt.scrollIntoViewIfNeeded();
        await opt.click();
        await this.page.waitForTimeout(600);
        console.log(`  Dropdown col ${colIndex} = "${optionText}" via "${sel}"`);
        return;
      }
    }
    console.log(`  Option "${optionText}" not found for col ${colIndex}`);
  }

  // Click the Search button to apply filters
  async clickSearch() {
    const btn = this.page.getByText('Search', { exact: true });
    if (await btn.count() > 0) {
      await btn.click();
      await this.page.waitForTimeout(4000);
    } else {
      // Some order grids filter on-the-fly without a Search button
      await this.page.waitForTimeout(3000);
    }
    console.log('  Search → pagination:', await this.getPaginationText());
  }

  // Click the Clear button to reset filters
  async clickClear() {
    const btn = this.page.getByText('Clear', { exact: true });
    if (await btn.count() > 0) {
      await btn.click();
      await this.page.waitForTimeout(3000);
    }
    console.log('  Clear → pagination:', await this.getPaginationText());
  }

  // Get the cell value from a specific row + column
  async getCellText(rowIndex: number, colIndex: number): Promise<string> {
    const cell = this.page.locator('tbody tr').nth(rowIndex).locator('td').nth(colIndex);
    return (await cell.innerText({ timeout: 5000 }).catch(() => '')).trim();
  }

  // ── Ribbon button locators ─────────────────────────────────────────────────
  editBtn    = () => this.page.getByText(RIBBON.EDIT,    { exact: true }).filter({ visible: true }).first();
  cancelBtn  = () => this.page.getByText(RIBBON.CANCEL,  { exact: true }).filter({ visible: true }).first();
  exportBtn  = () => this.page.getByText(RIBBON.EXPORT,  { exact: true }).filter({ visible: true }).first();
  refreshBtn = () => this.page.getByText(RIBBON.REFRESH, { exact: true }).filter({ visible: true }).first();
  clearBtn   = () => this.page.getByText(RIBBON.CLEAR,   { exact: true }).filter({ visible: true }).first();
  searchBtn  = () => this.page.getByText(RIBBON.SEARCH,  { exact: true }).filter({ visible: true }).first();

  // ── Ribbon visibility checks ───────────────────────────────────────────────
  async ribbonButtonsVisible(): Promise<Record<string, boolean>> {
    return {
      [RIBBON.EDIT]:    await this.editBtn().isVisible({ timeout: 2000 }).catch(() => false),
      [RIBBON.CANCEL]:  await this.cancelBtn().isVisible({ timeout: 2000 }).catch(() => false),
      [RIBBON.EXPORT]:  await this.exportBtn().isVisible({ timeout: 2000 }).catch(() => false),
      [RIBBON.REFRESH]: await this.refreshBtn().isVisible({ timeout: 2000 }).catch(() => false),
    };
  }

  // ── Ribbon collapse / expand ───────────────────────────────────────────────

  // Collapse the ribbon by clicking the double-up chevron icon
  async clickCollapseRibbon() {
    const btn = this.page.locator('.fal.fa-angle-double-up').first();
    await btn.click();
    await this.page.waitForTimeout(500);
    console.log('  Ribbon collapsed');
  }

  // Expand the ribbon by clicking the double-down chevron icon
  async clickExpandRibbon() {
    const btn = this.page.locator('.fal.fa-angle-double-down').first();
    await btn.click();
    await this.page.waitForTimeout(500);
    console.log('  Ribbon expanded');
  }

  // ── Ribbon button assertion helpers ───────────────────────────────────────

  // Assert that a ribbon button with the given label is NOT visible
  async expectRibbonButtonHidden(label: string) {
    const btn = this.page.getByText(label, { exact: true }).first();
    await expect(btn).not.toBeVisible({ timeout: 5000 });
  }

  // Assert that a ribbon button with the given label IS visible
  async expectRibbonButtonVisible(label: string) {
    const btn = this.page.getByText(label, { exact: true }).first();
    await expect(btn).toBeVisible({ timeout: 5000 });
  }

  // ── Status helpers ─────────────────────────────────────────────────────────
  async getOrderStatus(rowIndex = 0): Promise<string> {
    const statusColIdx = await this.findColumnIndex(COLUMN.STATUS);
    return this.getCellText(rowIndex, statusColIdx);
  }

  async findOrdersByStatus(status: string): Promise<string[]> {
    const idColIdx     = await this.findColumnIndex(COLUMN.ID);
    const statusColIdx = await this.findColumnIndex(COLUMN.STATUS);
    const rowCount     = await this.page.locator('tbody tr').count();
    const ids: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      const id  = (await this.getCellText(i, idColIdx)).trim();
      const st  = (await this.getCellText(i, statusColIdx)).trim();
      if (id && st === status) ids.push(id);
    }
    return ids;
  }

  // ── Row interaction ────────────────────────────────────────────────────────

  // Click the checkbox in the first cell of a given row (index 0-based)
  async selectRowCheckbox(rowIndex: number) {
    const row = this.page.locator('tbody tr').nth(rowIndex);
    const checkbox = row.locator('input[type="checkbox"]').first();
    if (await checkbox.count() > 0) {
      await checkbox.click();
    } else {
      // Fallback: click the first cell which may contain a custom checkbox component
      await row.locator('td').first().click();
    }
    await this.page.waitForTimeout(300);
    console.log(`  Row ${rowIndex} checkbox selected`);
  }

  // Double-click a row to open its detail view
  async openOrderDetail(rowIndex: number) {
    const row = this.page.locator('tbody tr').nth(rowIndex);
    await row.dblclick();
    await this.page.waitForTimeout(2000);
    console.log(`  Opened detail for row ${rowIndex}`);
  }

  // Close the order detail view — press Escape first, fall back to a close button
  async closeOrderDetail() {
    // Try a visible close/cancel button inside the detail panel or dialog
    const closeSelectors = [
      'button[aria-label="Close"]',
      'button[aria-label="close"]',
      '.modal-close',
      '.close-button',
      'lb-modal button.close',
      'lb-panel button.close',
    ];

    for (const sel of closeSelectors) {
      const btn = this.page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.click();
        await this.page.waitForTimeout(800);
        console.log(`  Detail closed via "${sel}"`);
        return;
      }
    }

    // Default: press Escape
    await this.pressEscape();
    await this.page.waitForTimeout(800);
    console.log('  Detail closed via Escape');
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  // Click the Export ribbon button
  async clickExport() {
    await this.exportBtn().click();
    await this.page.waitForTimeout(3000);
  }

  // Alias for clickExport — explicitly named for "export all" scenarios
  async clickExportAll() {
    await this.clickExport();
  }
}
