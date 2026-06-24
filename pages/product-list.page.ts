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

  // ── Filter row helpers ─────────────────────────────────────────────────────

  // Get the filter row cell at a given 0-based column index.
  // The filter row is the second <tr> inside <thead>.
  filterCell(colIndex: number) {
    return this.page.locator(`thead tr:nth-child(2) td:nth-child(${colIndex + 1})`);
  }

  // Type a text value into the filter input of the given column.
  async setTextFilter(colIndex: number, value: string) {
    const cell = this.filterCell(colIndex);
    await cell.waitFor({ state: 'visible', timeout: 10000 });
    const input = cell.locator('input').first();
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.fill(value);
    await this.page.waitForTimeout(300);
  }

  // Select an option from a dropdown filter in the given column.
  async setDropdownFilter(colIndex: number, optionText: string) {
    const cell = this.filterCell(colIndex);
    await cell.waitFor({ state: 'visible', timeout: 10000 });
    const select = cell.locator('select').first();
    if (await select.count() > 0) {
      await select.selectOption({ label: optionText });
    } else {
      // Fallback: treat it as a custom dropdown — click the trigger then the option
      await cell.click();
      await this.page.getByRole('option', { name: optionText }).first().click();
    }
    await this.page.waitForTimeout(300);
  }

  // Click the Search ribbon button to apply active filters.
  async clickSearch() {
    await this.searchBtn().click();
    await this.page.waitForTimeout(5000);
  }

  // Extract the total record count from pagination text (e.g. "1 - 50 of 108" → 108).
  async getPaginationTotal(): Promise<number> {
    const text = await this.page.locator('text=/\\d+ - \\d+ of \\d+/').innerText();
    const match = text.match(/of (\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  // Get the trimmed inner text of a specific table cell (both indices 0-based).
  async getCellText(rowIndex: number, colIndex: number): Promise<string> {
    const cell = this.page.locator(`tbody tr:nth-child(${rowIndex + 1}) td:nth-child(${colIndex + 1})`);
    await cell.waitFor({ state: 'visible', timeout: 10000 });
    return (await cell.innerText()).trim();
  }

  // Return the 0-based index of the column whose header title matches titleText.
  // Returns -1 if not found.
  async findColumnIndex(titleText: string): Promise<number> {
    const headers = this.page.locator('thead tr:first-child th');
    const count = await headers.count();
    for (let i = 0; i < count; i++) {
      const title = await headers.nth(i).getAttribute('title');
      const text  = await headers.nth(i).innerText();
      if (title?.trim() === titleText || text.trim() === titleText) {
        return i;
      }
    }
    return -1;
  }

  // ── Ribbon collapse / expand ───────────────────────────────────────────────

  // Collapse the ribbon toolbar by clicking the double-up chevron icon.
  async clickCollapseRibbon() {
    await this.page.locator('.fal.fa-angle-double-up').first().click();
    await this.page.waitForTimeout(1000);
  }

  // Expand the ribbon toolbar by clicking the double-down chevron icon.
  async clickExpandRibbon() {
    await this.page.locator('.fal.fa-angle-double-down').first().click();
    await this.page.waitForTimeout(1000);
  }

  // Assert that a ribbon button with the given label is NOT visible.
  async expectRibbonButtonHidden(label: string) {
    await expect(
      this.page.getByText(label, { exact: true }).filter({ visible: true }).first()
    ).toBeHidden({ timeout: 5000 });
  }

  // Assert that a ribbon button with the given label IS visible.
  async expectRibbonButtonVisible(label: string) {
    await expect(
      this.page.getByText(label, { exact: true }).first()
    ).toBeVisible({ timeout: 10000 });
  }

  // ── Mass edit ─────────────────────────────────────────────────────────────

  // Click the "Mass edit" ribbon button.
  async clickMassEdit() {
    await this.page.getByText('Mass edit', { exact: true }).filter({ visible: true }).first().click();
    await this.page.waitForTimeout(5000);
  }

  // Returns the mass-edit modal locator (first visible dialog).
  massEditModal() {
    return this.page.locator('lb-modal, lb-dialog, [role="dialog"]').filter({ visible: true }).first();
  }

  // Returns true if the mass-edit modal is visible.
  async isMassEditModalVisible(timeout = 5000): Promise<boolean> {
    return this.massEditModal().isVisible({ timeout }).catch(() => false);
  }

  // Get the text content of the mass-edit modal (first 200 chars for logging).
  async getMassEditModalText(): Promise<string> {
    return ((await this.massEditModal().textContent()) || '').slice(0, 200);
  }

  // Enable the nth lb-checkbox (0-based) inside the mass-edit modal.
  async enableMassEditCheckbox(index: number) {
    const modal = this.massEditModal();
    const lbCb = modal.locator('lb-checkbox').filter({ visible: true }).nth(index);
    await lbCb.click({ force: true });
    await this.page.waitForTimeout(600);
  }

  // Return the count of visible lb-checkbox elements inside the mass-edit modal.
  async getMassEditCheckboxCount(): Promise<number> {
    return this.massEditModal().locator('lb-checkbox').filter({ visible: true }).count();
  }

  // Return true if the first visible toggle inside the mass-edit modal is ON.
  async isMassEditToggleOn(): Promise<boolean> {
    const toggle = this.massEditModal()
      .locator('lb-toggle, lb-switch, [role="switch"]')
      .filter({ visible: true })
      .first();
    if (await toggle.count() === 0) return false;
    return toggle.evaluate(el =>
      el.getAttribute('aria-checked') === 'true' ||
      el.classList.contains('checked') ||
      el.classList.contains('active')
    ).catch(() => false);
  }

  // Click the first visible toggle inside the mass-edit modal.
  async clickMassEditToggle() {
    const toggle = this.massEditModal()
      .locator('lb-toggle, lb-switch, [role="switch"]')
      .filter({ visible: true })
      .first();
    await toggle.click({ force: true });
    await this.page.waitForTimeout(400);
  }

  // Return true if the Apply button exists inside the mass-edit modal.
  async isMassEditApplyVisible(timeout = 3000): Promise<boolean> {
    return this.massEditModal()
      .getByRole('button', { name: /apply|anwenden|übernehmen/i })
      .filter({ visible: true })
      .first()
      .isVisible({ timeout })
      .catch(() => false);
  }

  // Click the Apply button inside the mass-edit modal.
  async clickMassEditApply() {
    await this.massEditModal()
      .getByRole('button', { name: /apply|anwenden|übernehmen/i })
      .filter({ visible: true })
      .first()
      .click();
    await this.page.waitForTimeout(5000);
  }

  // Close the mass-edit modal via its X button, falling back to Escape.
  async closeMassEditModal() {
    const modal = this.massEditModal();
    const closeBtn = modal
      .locator('.close-button, [aria-label="Close"], [aria-label="close"], button.close, [class*="close"]')
      .filter({ visible: true })
      .first();
    if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await closeBtn.click();
      await this.page.waitForTimeout(2000);
    } else {
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(1500);
    }
  }

  // Return true if a success/toast/notification element is currently visible.
  async isSuccessVisible(timeout = 5000): Promise<boolean> {
    return this.page
      .locator('[class*="success"], [class*="toast"], [class*="notification"], [class*="alert"]')
      .filter({ visible: true })
      .first()
      .isVisible({ timeout })
      .catch(() => false);
  }

  // Return the trimmed inner text of a specific row (0-based).
  async getRowText(rowIndex: number): Promise<string> {
    return ((await this.page.locator('tbody tr').nth(rowIndex).textContent()) || '').trim();
  }

  // Return all header texts from the first thead row (trimmed, first line only).
  async getHeaderTexts(): Promise<string[]> {
    const raw = await this.page.locator('thead tr').first().locator('th, td').allInnerTexts();
    return raw.map(h => h.trim().split('\n')[0]);
  }

  // Return the trimmed innerText of a cell inside a specific row, identified by
  // column index (both 0-based). Uses evaluate so it works with Angular-rendered text.
  async getRowCellText(rowIndex: number, colIndex: number): Promise<string> {
    return this.page.locator('tbody tr').nth(rowIndex).locator('td').nth(colIndex)
      .evaluate((el: HTMLElement) => el.innerText.trim())
      .catch(() => '');
  }

  // Return true if the cell at (rowIndex, colIndex) shows an active/checked state.
  // Checks for fa-check icons, native checkboxes, and lb-checkbox components.
  async isCellActive(rowIndex: number, colIndex: number): Promise<boolean> {
    return this.page.locator('tbody tr').nth(rowIndex).locator('td').nth(colIndex)
      .evaluate((el: HTMLElement) => {
        if (el.querySelector('.fa-check, [class*="fa-check"]')) return true;
        const cb = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (cb) return cb.checked;
        const lbCb = el.querySelector('lb-checkbox');
        if (lbCb) {
          const inner = lbCb.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
          if (inner) return inner.checked;
          return lbCb.getAttribute('aria-checked') === 'true';
        }
        return false;
      })
      .catch(() => false);
  }

  // ── Product detail ────────────────────────────────────────────────────────

  // Double-click the row at the given 0-based index to open the product detail view.
  async openProductDetail(rowIndex: number) {
    const row = this.page.locator('tbody tr').nth(rowIndex);
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.scrollIntoViewIfNeeded();
    await row.dblclick();
    await this.page.waitForTimeout(10000);
  }

  // ── Stock import button ────────────────────────────────────────────────────

  // Locator for the "Stock import" ribbon button.
  stockImportBtn() {
    return this.page.getByText('Stock import', { exact: true }).filter({ visible: true }).first();
  }

  // Click "Stock import" and wait for the dialog.
  async clickStockImport() {
    await this.stockImportBtn().click();
    await this.page.waitForTimeout(10000);
  }

  // Open the stock import dialog, checking if already open first.
  // Returns true when the file input is present (dialog is open).
  async openStockImportDialog(): Promise<boolean> {
    if (await this.isFileInputPresent()) return true;
    await this.page.waitForTimeout(2000);
    const visible = await this.stockImportBtn().isVisible({ timeout: 5000 }).catch(() => false);
    if (!visible) return false;
    await this.stockImportBtn().click();
    await this.page.waitForTimeout(3000);
    return this.isFileInputPresent();
  }

  // Return every button's text content as a string array.
  async getAllButtonTexts(): Promise<string[]> {
    return this.page.getByRole('button').allTextContents();
  }

  // Return the raw (non-lowercased) innerText of <body>.
  async getRawBodyText(): Promise<string> {
    return this.page.locator('body').innerText({ timeout: 10000 });
  }

  // Dismiss a confirm/error overlay by clicking OK/Close/Cancel or pressing Escape.
  async dismissOverlay() {
    try {
      const btn = this.page.getByRole('button', { name: /OK|Close|Cancel/i }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        await this.page.waitForTimeout(3000);
        return;
      }
    } catch {}
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(1500);
  }

  // Click the explicit "Close" text button (used after stock import completes).
  async clickCloseButton() {
    const closeBtn = this.page.getByText('Close', { exact: true });
    if (await closeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await closeBtn.click();
    }
  }

  // ── Import dialog helpers ──────────────────────────────────────────────────

  // Returns the first file input locator inside the import dialog.
  fileInput() {
    return this.page.locator('input[type="file"]').first();
  }

  // Returns true if a file input is currently present in the DOM.
  async isFileInputPresent(): Promise<boolean> {
    return (await this.page.locator('input[type="file"]').count()) > 0;
  }

  // Returns the value of the `accept` attribute on the file input, or empty string.
  async getFileInputAccept(): Promise<string> {
    return (await this.fileInput().getAttribute('accept').catch(() => '')) ?? '';
  }

  // Attach a file to the first file input in the dialog.
  async attachFile(filePath: string) {
    await this.fileInput().setInputFiles(filePath);
  }

  // Return the full lowercased innerText of <body> for result detection.
  async getBodyText(): Promise<string> {
    return (await this.page.locator('body').innerText({ timeout: 10000 }).catch(() => '')).toLowerCase();
  }

  // Click the first visible Close/Cancel/Back/Done/Finish/OK button, falling back to Escape.
  async closeImportDialog() {
    const pattern = /Cancel|Close|Back|Done|Finish|OK/i;
    try {
      const btn = this.page.getByRole('button', { name: pattern }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        await this.page.waitForTimeout(2000);
        return;
      }
    } catch {}
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(1500);
  }

  // Try to click one of the common run/submit buttons inside the import dialog.
  // Returns true if a button was clicked.
  async clickImportRunButton(): Promise<boolean> {
    const candidates = ['Run', 'Start', 'Execute', 'Import', 'Upload', 'OK', 'Confirm', 'Submit'];
    for (const name of candidates) {
      try {
        const btn = this.page.getByRole('button', { name }).first();
        if (
          await btn.isVisible({ timeout: 2000 }) &&
          (await btn.isEnabled({ timeout: 500 }).catch(() => false))
        ) {
          await btn.click();
          await this.page.waitForTimeout(3000);
          return true;
        }
      } catch {}
    }
    return false;
  }

  // Return the locator for all visible .dropdown-item elements (used after opening a dropdown)
  getDropdownItems() {
    return this.page.locator('.dropdown-item').filter({ visible: true });
  }

  // Return a locator for a specific visible dropdown item by text
  getDropdownItemByText(text: string) {
    return this.page.locator(`.dropdown-item:has-text("${text}")`).filter({ visible: true }).first();
  }

  // Return the first visible table/grid element
  getTable() {
    return this.page.locator('table, [class*="grid"], [class*="table"]').first();
  }

  // Check whether the page body is still visible (page alive / no crash)
  async isPageAlive(): Promise<boolean> {
    return this.page.locator('body').isVisible().catch(() => false);
  }

  // Return a column header element by its title attribute
  getColumnHeaderByTitle(title: string) {
    return this.page.getByTitle(title, { exact: true });
  }

  // Poll <body> text until a success/error keyword appears or the timeout expires.
  async waitForImportResult(timeoutMs = 120000): Promise<'success' | 'error' | 'timeout'> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.page.waitForTimeout(5000);
      const body = await this.getBodyText();
      if (body.includes('complete') || body.includes('success') || body.includes('finished')) return 'success';
      if (body.includes('error') || body.includes('invalid') || body.includes('failed')) return 'error';
    }
    return 'timeout';
  }
}
