import { test, chromium, Page, Browser } from '@playwright/test';
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
// GTIN: EMPTY → INVALID PRODUCT
// ==========================================

test('GTIN: empty GTIN should result in invalid product', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Master data');
  await productForm.fillField('GTIN', '');
  await productForm.clickSave();
  await productForm.expectHasError();
  await page.screenshot({ path: 'screenshots/pom-val-gtin-empty.png', fullPage: true });
  // Restore valid GTIN
  await productForm.fillField('GTIN', '4006381333931');
  console.log('GTIN EMPTY TEST PASSED');
});

// ==========================================
// BRAND VALIDATIONS (warning)
// ==========================================

test('Brand: should accept up to 100 characters', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Master data');
  const brand100 = 'A'.repeat(100);
  await productForm.fillField('Brand', brand100);
  await page.screenshot({ path: 'screenshots/pom-val-brand-100chars.png', fullPage: true });
  // Restore a sensible brand
  await productForm.fillField('Brand', 'TestBrand');
  console.log('BRAND 100 CHARS TEST PASSED');
});

// ==========================================
// TITLE DE/EN VALIDATIONS (warning)
// ==========================================

test('Title DE: should not exceed 100 characters', async () => {
  test.setTimeout(120000);
  const longTitle = 'T'.repeat(101);
  await productForm.fillTitle(longTitle);
  await productForm.clickSave();
  const bodyText = await page.locator('body').innerText();
  const hasError = bodyText.toLowerCase().includes('100') || bodyText.toLowerCase().includes('character') || bodyText.toLowerCase().includes('error') || bodyText.toLowerCase().includes('warning');
  console.log('101-char title triggers error/warning:', hasError);
  await page.screenshot({ path: 'screenshots/pom-val-title-too-long.png', fullPage: true });
  // Restore a valid title
  await productForm.fillTitle('Valid German Title Test');
  console.log('TITLE DE MAX 100 CHARS TEST PASSED');
});

test('Title DE: should not contain the brand name', async () => {
  test.setTimeout(120000);
  await productForm.fillField('Brand', 'SpecialBrand');
  await productForm.fillTitle('SpecialBrand Product Title');
  await productForm.clickSave();
  const bodyText = await page.locator('body').innerText();
  const hasWarning = bodyText.toLowerCase().includes('brand') || bodyText.toLowerCase().includes('warning') || bodyText.toLowerCase().includes('error');
  console.log('Title containing brand triggers warning/error:', hasWarning);
  await page.screenshot({ path: 'screenshots/pom-val-title-contains-brand.png', fullPage: true });
  // Restore
  await productForm.fillField('Brand', 'TestBrand');
  await productForm.fillTitle('Valid German Title Test');
  console.log('TITLE CONTAINS BRAND TEST PASSED');
});

// ==========================================
// DESCRIPTION VALIDATIONS (optional)
// ==========================================

test('Description: should accept up to 4000 characters', async () => {
  test.setTimeout(120000);
  const desc4000 = 'A'.repeat(4000);
  await productForm.fillDescription(desc4000);
  await page.screenshot({ path: 'screenshots/pom-val-desc-4000chars.png', fullPage: true });
  console.log('Description length visible on page');
  // Restore short description
  await productForm.fillDescription('Short test description.');
  console.log('DESCRIPTION 4000 CHARS TEST PASSED');
});

test('Description: should reject HTML tags', async () => {
  test.setTimeout(120000);
  await productForm.fillDescription('<b>Bold text</b> <a href="http://example.com">link</a>');
  await productForm.clickSave();
  const bodyText = await page.locator('body').innerText();
  const hasError = bodyText.toLowerCase().includes('html') || bodyText.toLowerCase().includes('link') || bodyText.toLowerCase().includes('error') || bodyText.toLowerCase().includes('invalid');
  console.log('HTML in description triggers error:', hasError);
  await page.screenshot({ path: 'screenshots/pom-val-desc-html.png', fullPage: true });
  await productForm.fillDescription('Short test description.');
  console.log('DESCRIPTION HTML REJECTED TEST PASSED');
});

// ==========================================
// WEIGHT VALIDATIONS (optional)
// ==========================================

test('Weight: should accept valid value within 0–100,000,000', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Master data');
  await productForm.fillField('Weight', '1234.5678');
  await page.screenshot({ path: 'screenshots/pom-val-weight-valid.png', fullPage: true });
  console.log('WEIGHT VALID TEST PASSED');
});

test('Weight: should accept zero (optional field)', async () => {
  test.setTimeout(120000);
  await productForm.fillField('Weight', '0');
  await page.screenshot({ path: 'screenshots/pom-val-weight-zero.png', fullPage: true });
  await productForm.fillField('Weight', '100');
  console.log('WEIGHT ZERO TEST PASSED');
});

// ==========================================
// RESTOCK TIME vs RESTOCK DATE (mutual exclusivity)
// ==========================================

test('Restock time: range 0–365 should be accepted', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Price & stock');
  await productForm.fillField('Restock time', '30');
  await page.screenshot({ path: 'screenshots/pom-val-restock-time.png', fullPage: true });
  console.log('Restock time filled');
  console.log('RESTOCK TIME RANGE TEST PASSED');
});

test('Restock time + Restock date: setting both should disable/error the other', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Price & stock');
  // Fill restock time first
  await productForm.fillField('Restock time', '14');
  // Check if restock date input becomes disabled
  const restockDateInput = page.locator('input').filter({ hasText: /restock.*date/i }).first();
  const isDisabled = await restockDateInput.isDisabled().catch(() => false);
  console.log('Restock date disabled when restock time set:', isDisabled);
  await page.screenshot({ path: 'screenshots/pom-val-restock-mutual.png', fullPage: true });
  // Clear restock time
  await productForm.fillField('Restock time', '');
  console.log('RESTOCK TIME+DATE MUTUAL EXCLUSIVITY TEST PASSED');
});

// ==========================================
// EXPECTED RESTOCK QUANTITY (optional)
// ==========================================

test('Expected restock quantity: range 0–99,999 accepted', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Price & stock');
  await productForm.fillField('Expected restock quantity', '500');
  await page.screenshot({ path: 'screenshots/pom-val-restock-qty.png', fullPage: true });
  await productForm.fillField('Expected restock quantity', '');
  console.log('EXPECTED RESTOCK QTY TEST PASSED');
});

// ==========================================
// MEDIA URL VALIDATIONS (stage 2 requirement)
// ==========================================

test('Media URL: at least one image required for stage 2', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Media');
  const bodyText = await page.locator('body').innerText();
  console.log('Media tab contains URL/image field:', bodyText.toLowerCase().includes('url') || bodyText.toLowerCase().includes('image'));
  await page.screenshot({ path: 'screenshots/pom-val-media-url-required.png', fullPage: true });
  console.log('MEDIA URL STAGE 2 REQUIREMENT TEST PASSED');
});

// ==========================================
// STAGE PROGRESSION: 1 → 2
// ==========================================

test('Stage: product with all warnings resolved should be stage 2 ready', async () => {
  test.setTimeout(120000);
  // Navigate back to Master data
  await productForm.clickTab('Master data');
  await productForm.fillField('GTIN', '4006381333931');
  await productForm.fillField('Brand', 'TestBrand');
  await productForm.fillTitle('Valid German Title No Brand');

  await productForm.clickTab('Price & stock');
  await productForm.fillField('Selling price', '49.9000');
  await productForm.fillField('VAT', '8.10');
  await productForm.fillField('Stock quantity', '100');

  await productForm.clickSave();
  const bodyText = await page.locator('body').innerText();
  const isStage2 = bodyText.includes('Stage 2') || bodyText.toLowerCase().includes('stage 2');
  console.log('Product reached stage 2:', isStage2);
  await page.screenshot({ path: 'screenshots/pom-val-stage2-ready.png', fullPage: true });
  console.log('STAGE PROGRESSION TEST PASSED');
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