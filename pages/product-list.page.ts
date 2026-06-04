import { Page, expect } from '@playwright/test';

export class ProductListPage {
  constructor(private page: Page) {}

  // Locators
  private newButton = () => this.page.getByText('New', { exact: true });
  private importButton = () => this.page.getByText('Import', { exact: true });
  private refreshButton = () => this.page.getByText('Refresh', { exact: true });
  private clearButton = () => this.page.getByText('Clear', { exact: true });
  private pagination = () => this.page.locator('text=/\\d+ - \\d+ of \\d+/');

  // Actions
  async clickNew() {
    await this.newButton().dispatchEvent('click');
    await this.page.waitForTimeout(10000);
  }

  async clickImport() {
    await this.importButton().click();
    await this.page.waitForTimeout(10000);
  }

  async clickRefresh() {
    await this.refreshButton().click();
    await this.page.waitForTimeout(10000);
  }

  async clearFilters() {
    await this.clearButton().click();
    await this.page.waitForTimeout(3000);
  }

  async getPaginationText() {
    return await this.pagination().innerText();
  }

  async getRowCount() {
    return await this.page.locator('tbody tr').count();
  }

  async doubleClickProduct(productText: string) {
    const row = this.page.locator('tr').filter({ hasText: productText }).first();
    await row.dblclick();
    await this.page.waitForTimeout(10000);
  }

  // Assertions
  async expectTableVisible() {
    await expect(this.page.getByTitle('ID', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(this.page.getByTitle('Category', { exact: true })).toBeVisible();
    await expect(this.page.getByTitle('Name', { exact: true })).toBeVisible();
    await expect(this.page.getByTitle('Price', { exact: true })).toBeVisible();
  }

  async expectToolbarVisible() {
    await expect(this.refreshButton()).toBeVisible({ timeout: 15000 });
    await expect(this.page.getByText('Search', { exact: true })).toBeVisible();
    await expect(this.page.getByText('Filter and sorting', { exact: true })).toBeVisible();
    await expect(this.page.getByText('Mass edit', { exact: true })).toBeVisible();
  }
}