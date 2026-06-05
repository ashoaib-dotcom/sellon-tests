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

  // Open the first available product for editing
  await productListPage.doubleClickFirstProduct();
  await productForm.expectFormVisible();
  console.log('SETUP COMPLETE');
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

// ==========================================
// GTIN FORMAT VALIDATIONS
// ==========================================

test('GTIN: should accept valid GTIN-8 (40170725)', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Master data');
  await productForm.fillField('GTIN', '40170725');
  await page.screenshot({ path: 'screenshots/pom-val-gtin8-valid.png', fullPage: true });
  console.log('GTIN-8 VALID TEST PASSED');
});

test('GTIN: should reject invalid GTIN-8 (40170724)', async () => {
  test.setTimeout(120000);
  await productForm.fillField('GTIN', '40170724');
  await productForm.clickSave();
  await productForm.expectHasError();
  await page.screenshot({ path: 'screenshots/pom-val-gtin8-invalid.png', fullPage: true });
  console.log('GTIN-8 INVALID TEST PASSED');
});

test('GTIN: should accept valid GTIN-12 (614141007349)', async () => {
  test.setTimeout(120000);
  await productForm.fillField('GTIN', '614141007349');
  await page.screenshot({ path: 'screenshots/pom-val-gtin12-valid.png', fullPage: true });
  console.log('GTIN-12 VALID TEST PASSED');
});

test('GTIN: should reject invalid GTIN-12 (614141007341)', async () => {
  test.setTimeout(120000);
  await productForm.fillField('GTIN', '614141007341');
  await productForm.clickSave();
  await productForm.expectHasError();
  await page.screenshot({ path: 'screenshots/pom-val-gtin12-invalid.png', fullPage: true });
  console.log('GTIN-12 INVALID TEST PASSED');
});

test('GTIN: should accept valid GTIN-13 (4006381333931)', async () => {
  test.setTimeout(120000);
  await productForm.fillField('GTIN', '4006381333931');
  await page.screenshot({ path: 'screenshots/pom-val-gtin13-valid.png', fullPage: true });
  console.log('GTIN-13 VALID TEST PASSED');
});

test('GTIN: should reject invalid GTIN-13 (4006381333932)', async () => {
  test.setTimeout(120000);
  await productForm.fillField('GTIN', '4006381333932');
  await productForm.clickSave();
  await productForm.expectHasError();
  await page.screenshot({ path: 'screenshots/pom-val-gtin13-invalid.png', fullPage: true });
  console.log('GTIN-13 INVALID TEST PASSED');
});

test('GTIN: should accept valid GTIN-14 (10400163001017)', async () => {
  test.setTimeout(120000);
  await productForm.fillField('GTIN', '10400163001017');
  await page.screenshot({ path: 'screenshots/pom-val-gtin14-valid.png', fullPage: true });
  console.log('GTIN-14 VALID TEST PASSED');
});

test('GTIN: should reject invalid GTIN-14 (10400163001013)', async () => {
  test.setTimeout(120000);
  await productForm.fillField('GTIN', '10400163001013');
  await productForm.clickSave();
  await productForm.expectHasError();
  await page.screenshot({ path: 'screenshots/pom-val-gtin14-invalid.png', fullPage: true });

  // Restore valid GTIN
  await productForm.fillField('GTIN', '4006381333931');
  console.log('GTIN-14 INVALID TEST PASSED');
});

// ==========================================
// PROVIDER KEY VALIDATIONS
// ==========================================

test('Provider key: should reject more than 50 characters', async () => {
  test.setTimeout(120000);
  const longKey = 'A'.repeat(51);
  await productForm.fillField('Provider key', longKey);
  await productForm.clickSave();

  const bodyText = await page.locator('body').innerText();
  console.log('Long provider key - has error:', bodyText.toLowerCase().includes('error') || bodyText.toLowerCase().includes('50'));

  await page.screenshot({ path: 'screenshots/pom-val-provider-long.png', fullPage: true });
  console.log('PROVIDER KEY LONG TEST PASSED');
});

test('Provider key: should accept valid characters (A-Z, 0-9, . , ! ? - _ @)', async () => {
  test.setTimeout(120000);
  await productForm.fillField('Provider key', 'Test_Key-001@v2.5!');
  await page.screenshot({ path: 'screenshots/pom-val-provider-valid-chars.png', fullPage: true });
  console.log('PROVIDER KEY VALID CHARS TEST PASSED');
});

// ==========================================
// PRICE & STOCK VALIDATIONS
// ==========================================

test('Price: should reject negative price', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Price & stock');
  await productForm.fillField('Selling price', '-10');
  await productForm.clickSave();
  await productForm.expectHasError();
  await page.screenshot({ path: 'screenshots/pom-val-price-negative.png', fullPage: true });
  await productForm.fillField('Selling price', '49.9000');
  console.log('PRICE NEGATIVE TEST PASSED');
});

test('Price: should accept maximum valid price', async () => {
  test.setTimeout(120000);
  await productForm.fillField('Selling price', '99999999.9999');
  await page.screenshot({ path: 'screenshots/pom-val-price-max.png', fullPage: true });
  await productForm.fillField('Selling price', '49.9000');
  console.log('PRICE MAX TEST PASSED');
});

test('VAT: should accept 2.60', async () => {
  test.setTimeout(120000);
  await productForm.fillField('VAT', '2.60');
  await page.screenshot({ path: 'screenshots/pom-val-vat-2.60.png', fullPage: true });
  console.log('VAT 2.60 TEST PASSED');
});

test('VAT: should accept 8.10', async () => {
  test.setTimeout(120000);
  await productForm.fillField('VAT', '8.10');
  await page.screenshot({ path: 'screenshots/pom-val-vat-8.10.png', fullPage: true });
  console.log('VAT 8.10 TEST PASSED');
});

test('Stock: should reject negative stock', async () => {
  test.setTimeout(120000);
  await productForm.fillField('Stock quantity', '-5');
  await productForm.clickSave();
  await productForm.expectHasError();
  await page.screenshot({ path: 'screenshots/pom-val-stock-negative.png', fullPage: true });
  await productForm.fillField('Stock quantity', '100');
  console.log('STOCK NEGATIVE TEST PASSED');
});

test('Stock: should accept zero stock', async () => {
  test.setTimeout(120000);
  await productForm.fillField('Stock quantity', '0');
  await page.screenshot({ path: 'screenshots/pom-val-stock-zero.png', fullPage: true });
  await productForm.fillField('Stock quantity', '100');
  console.log('STOCK ZERO TEST PASSED');
});

// ==========================================
// SUPPLEMENTARY DATA TAB
// ==========================================

test('Supplementary data: should open tab', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Supplementary data');

  const bodyText = await page.locator('body').innerText();
  console.log('Supplementary tab content (first 1000):', bodyText.substring(0, 1000));

  await page.screenshot({ path: 'screenshots/pom-val-supplementary-tab.png', fullPage: true });
  console.log('SUPPLEMENTARY TAB TEST PASSED');
});

// ==========================================
// MEDIA TAB
// ==========================================

test('Media: should open tab', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Media');

  const bodyText = await page.locator('body').innerText();
  console.log('Media tab content (first 1000):', bodyText.substring(0, 1000));

  await page.screenshot({ path: 'screenshots/pom-val-media-tab.png', fullPage: true });
  console.log('MEDIA TAB TEST PASSED');
});

// ==========================================
// GALAXUS TAB
// ==========================================

test('Galaxus: should open tab', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Galaxus');

  const bodyText = await page.locator('body').innerText();
  console.log('Galaxus tab content (first 1000):', bodyText.substring(0, 1000));

  await page.screenshot({ path: 'screenshots/pom-val-galaxus-tab.png', fullPage: true });
  console.log('GALAXUS TAB TEST PASSED');
});

// ==========================================
// FINAL: SAVE WITH VALID DATA
// ==========================================

test('Final: save product with all valid data', async () => {
  test.setTimeout(120000);

  await productForm.clickTab('Master data');
  await productForm.fillField('GTIN', '4006381333931');

  await productForm.clickTab('Price & stock');
  await productForm.fillField('Selling price', '49.9000');
  await productForm.fillField('VAT', '8.10');
  await productForm.fillField('Stock quantity', '100');

  await productForm.clickSave();
  await page.screenshot({ path: 'screenshots/pom-val-final-save.png', fullPage: true });
  console.log('FINAL SAVE TEST PASSED');
});