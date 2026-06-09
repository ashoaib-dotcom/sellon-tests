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
    headless: true,
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

  await loginPage.login(process.env.TEST_USERNAME || 'ashoaib', process.env.TEST_PASSWORD || 'test2');
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
  try { await page.screenshot({ path: 'screenshots/pom-edit-form-opened.png', fullPage: true, timeout: 5000 }); } catch {}
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
  try { await page.screenshot({ path: 'screenshots/pom-edit-brand.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('BRAND EDITED');
});

test('Edit: should edit Weight field', async () => {
  test.setTimeout(120000);
  await productForm.fillField('Weight', '95.0000');
  try { await page.screenshot({ path: 'screenshots/pom-edit-weight.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('WEIGHT EDITED');
});

test('Edit: should navigate to Price & stock tab', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Price & stock');
  await expect(page.getByText('Selling price', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('VAT', { exact: true })).toBeVisible();
  try { await page.screenshot({ path: 'screenshots/pom-edit-price-tab.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('PRICE & STOCK TAB OPENED');
});

test('Edit: should save the changes', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Master data');
  await productForm.clickSave();
  try { await page.screenshot({ path: 'screenshots/pom-edit-saved.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('SAVE COMPLETE');
});
// ==========================================
// NEGATIVE TESTS
// ==========================================

test('Edit negative: invalid GTIN checksum should be rejected on save', async () => {
  test.setTimeout(120000);

  await productForm.clickTab('Master data');

  // Read current GTIN and corrupt the check digit
  const gtinInput = page.getByLabel('GTIN', { exact: false }).first();
  const currentGtin = await gtinInput.inputValue().catch(() => '');
  const badGtin = currentGtin.length > 0
    ? currentGtin.slice(0, -1) + ((parseInt(currentGtin.slice(-1)) + 1) % 10)
    : '4006381333932';

  await productForm.fillField('GTIN', badGtin);
  await productForm.clickSave();
  await productForm.expectHasError();
  console.log('Invalid GTIN rejected — error shown');

  // Restore original GTIN
  if (currentGtin.length > 0) await productForm.fillField('GTIN', currentGtin);

  try { await page.screenshot({ path: 'screenshots/pom-edit-neg-gtin.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('EDIT NEG GTIN TEST PASSED');
});

test('Edit negative: empty provider key should be rejected on save', async () => {
  test.setTimeout(120000);

  await productForm.clickTab('Master data');

  // Read current provider key then clear it
  const pkInput = page.getByLabel('Provider key', { exact: false }).first();
  const currentPk = await pkInput.inputValue().catch(() => '');

  await productForm.fillField('Provider key', '');
  await productForm.clickSave();
  await productForm.expectHasError();
  console.log('Empty provider key rejected — error shown');

  // Restore
  if (currentPk.length > 0) await productForm.fillField('Provider key', currentPk);

  try { await page.screenshot({ path: 'screenshots/pom-edit-neg-provider-key.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('EDIT NEG PROVIDER KEY TEST PASSED');
});

test('Edit negative: invalid VAT value should be rejected on save', async () => {
  test.setTimeout(120000);

  await productForm.clickTab('Price & stock');

  await productForm.fillField('VAT', '99.99');
  await productForm.clickSave();
  await productForm.expectHasError();
  console.log('Invalid VAT rejected — error shown');

  // Restore valid VAT
  await productForm.fillField('VAT', '8.10');

  try { await page.screenshot({ path: 'screenshots/pom-edit-neg-vat.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('EDIT NEG VAT TEST PASSED');
});
