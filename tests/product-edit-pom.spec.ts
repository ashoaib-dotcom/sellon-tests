import { test, expect, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { NavigationPage } from '../pages/navigation.page';
import { ProductListPage } from '../pages/product-list.page';
import { ProductFormPage } from '../pages/product-form.page';

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let navPage: NavigationPage;
let productListPage: ProductListPage;
let productForm: ProductFormPage;

test.beforeAll(async () => {
  test.setTimeout(300000);

  browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  page = await context.newPage();
  loginPage = new LoginPage(page);
  navPage = new NavigationPage(page);
  productListPage = new ProductListPage(page);
  productForm = new ProductFormPage(page);

  await loginPage.login('ashoaib', 'test2');
  await navPage.navigateToProducts();
  console.log('SETUP COMPLETE');
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

test('Edit: should double-click a product to open edit form', async () => {
  test.setTimeout(120000);
  await productListPage.expectTableVisible();
  await productListPage.doubleClickFirstProduct();
  await productForm.expectFormVisible();
  await page.screenshot({ path: 'screenshots/pom-edit-form-opened.png', fullPage: true });
  console.log('EDIT FORM OPENED');
});

test('Edit: should verify Master data tab fields', async () => {
  test.setTimeout(60000);
  await expect(page.getByText('GTIN', { exact: true })).toBeVisible();
  await expect(page.getByText('Provider key', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Brand', { exact: true })).toBeVisible();
  await expect(page.getByText('Master data', { exact: true })).toBeVisible();
  await expect(page.getByText('Supplementary data', { exact: true })).toBeVisible();
  await expect(page.getByText('Price & stock', { exact: true })).toBeVisible();
  await expect(page.getByText('Media', { exact: true })).toBeVisible();
  console.log('MASTER DATA TAB VERIFIED');
});

test('Edit: should edit Brand field', async () => {
  test.setTimeout(120000);
  await productForm.fillField('Brand', 'PowerCell Updated');
  await page.screenshot({ path: 'screenshots/pom-edit-brand.png', fullPage: true });
  console.log('BRAND EDITED');
});

test('Edit: should edit Weight field', async () => {
  test.setTimeout(120000);
  await productForm.fillField('Weight', '95.0000');
  await page.screenshot({ path: 'screenshots/pom-edit-weight.png', fullPage: true });
  console.log('WEIGHT EDITED');
});

test('Edit: should navigate to Price & stock tab', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Price & stock');
  await expect(page.getByText('Selling price', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('VAT', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'screenshots/pom-edit-price-tab.png', fullPage: true });
  console.log('PRICE & STOCK TAB OPENED');
});

test('Edit: should save the changes', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Master data');
  await productForm.clickSave();
  await page.screenshot({ path: 'screenshots/pom-edit-saved.png', fullPage: true });
  console.log('SAVE COMPLETE');
});