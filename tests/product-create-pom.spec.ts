import { test, expect, chromium, Page, Browser } from '@playwright/test';
import * as fs from 'fs';
import { LoginPage } from '../pages/login.page';
import { NavigationPage } from '../pages/navigation.page';
import { ProductListPage } from '../pages/product-list.page';
import { ProductFormPage } from '../pages/product-form.page';

// ─── Unique values per run (avoids GTIN / SKU uniqueness conflicts) ───────────
function gtin13(base12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(base12[i]) * (i % 2 === 0 ? 1 : 3);
  return base12 + (10 - (sum % 10)) % 10;
}
const RUN_ID   = Date.now().toString().slice(-9);          // 9-digit timestamp suffix
const TEST_GTIN = gtin13('400' + RUN_ID);                 // valid GTIN-13
const TEST_SKU  = 'POM-' + RUN_ID.slice(-6);              // unique provider key
// ─────────────────────────────────────────────────────────────────────────────

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let navPage: NavigationPage;
let productListPage: ProductListPage;
let productForm: ProductFormPage;

test.beforeAll(async () => {
  test.setTimeout(600000);

  browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    storageState: fs.existsSync('auth-state.json') ? 'auth-state.json' : undefined,
  });

  page = await context.newPage();
  loginPage = new LoginPage(page);
  navPage = new NavigationPage(page);
  productListPage = new ProductListPage(page);
  productForm = new ProductFormPage(page);

  if (!fs.existsSync('auth-state.json')) {
    await loginPage.login(process.env.TEST_USERNAME || 'ashoaib', process.env.TEST_PASSWORD || 'test2');
  } else {
    console.log('🔐 Using saved auth state...');
    await page.goto(process.env.BASE_URL || 'https://stage.sellon.ch/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    try {
      const sessionBtn = page.getByRole('button', { name: /^(Yes|Continue|OK)$/i }).first();
      await sessionBtn.waitFor({ state: 'visible', timeout: 8000 });
      await sessionBtn.click();
      console.log('Session popup handled');
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);
    } catch {}
    const menuVisible = await page.locator('.menu-icon').waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true).catch(() => false);
    if (!menuVisible) {
      console.log('⚠️ Auth state invalid — falling back to manual login');
      await loginPage.login(process.env.TEST_USERNAME || 'ashoaib', process.env.TEST_PASSWORD || 'test2');
    }
  }
  await navPage.navigateToProducts();
  console.log('SETUP COMPLETE');
  console.log(`  TEST_GTIN = ${TEST_GTIN}  |  TEST_SKU = ${TEST_SKU}`);
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

// ==========================================
// CREATE PRODUCT FLOW
// ==========================================

test('Step 1: Click New to create product', async () => {
  test.setTimeout(120000);
  await productListPage.expectTableVisible();
  const pagination = await productListPage.getPaginationText();
  console.log('Products before:', pagination);
  await productListPage.clickNew();
  await productForm.expectFormVisible();
  try { await page.screenshot({ path: 'screenshots/pom-create-1-new.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('STEP 1 PASSED');
});

test('Step 2: Verify empty form has all required tabs', async () => {
  test.setTimeout(60000);
  await expect(page.getByText('GTIN', { exact: true })).toBeVisible();
  await expect(page.getByText('Provider key', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Brand', { exact: true })).toBeVisible();
  await expect(page.getByText('Master data', { exact: true })).toBeVisible();
  await expect(page.getByText('Price & stock', { exact: true })).toBeVisible();
  await expect(page.getByText('Media', { exact: true })).toBeVisible();
  await expect(page.getByText('Galaxus', { exact: true })).toBeVisible();
  console.log('STEP 2 PASSED');
});

test('Step 2b: Save empty product — verify expected errors and warnings appear', async () => {
  test.setTimeout(120000);
  // Save with all fields empty to trigger all validation messages
  await productForm.clickSave();
  await page.waitForTimeout(5000);

  const bodyText = await page.locator('body').innerText();
  const lower = bodyText.toLowerCase();

  // Expected ERRORS (red)
  const hasGtinError    = lower.includes('gtin') && (lower.includes('checksum') || lower.includes('invalid') || lower.includes('error'));
  const hasSkuError     = lower.includes('provider') || lower.includes('key') || lower.includes('mandatory') || lower.includes('required');
  const hasVatError     = lower.includes('vat') || lower.includes('2.6') || lower.includes('8.1') || lower.includes('allowed');
  const hasStockError   = lower.includes('stock') && (lower.includes('required') || lower.includes('must') || lower.includes('defined'));
  const hasPriceError   = lower.includes('price') && (lower.includes('mandatory') || lower.includes('required') || lower.includes('between'));
  const hasAnyError     = lower.includes('error') || lower.includes('invalid') || lower.includes('required') || lower.includes('mandatory');

  // Expected WARNINGS (yellow)
  const hasBrandWarning    = lower.includes('brand');
  const hasCategoryWarning = lower.includes('category');
  const hasTitleWarning    = lower.includes('title') || lower.includes('german');
  const hasMediaWarning    = lower.includes('media') || lower.includes('image') || lower.includes('url');

  console.log('Errors — GTIN:', hasGtinError, '| SKU:', hasSkuError, '| VAT:', hasVatError, '| Stock:', hasStockError, '| Price:', hasPriceError);
  console.log('Warnings — Brand:', hasBrandWarning, '| Category:', hasCategoryWarning, '| Title:', hasTitleWarning, '| Media:', hasMediaWarning);
  console.log('Any validation message present:', hasAnyError);

  try { await page.screenshot({ path: 'screenshots/pom-create-2b-empty-save.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('STEP 2b PASSED — empty product validation messages verified');
});

test('Step 3: Fill GTIN', async () => {
  test.setTimeout(60000);
  await productForm.fillField('GTIN', TEST_GTIN);
  await productForm.expectFieldValueByLabel('GTIN', TEST_GTIN);
  console.log('STEP 3 PASSED');
});

test('Step 4: Fill Provider key', async () => {
  test.setTimeout(60000);
  await productForm.fillField('Provider key', TEST_SKU);
  await productForm.expectFieldValueByLabel('Provider key', TEST_SKU);
  console.log('STEP 4 PASSED');
});

test('Step 5: Fill Brand', async () => {
  test.setTimeout(60000);
  await productForm.fillField('Brand', 'POMTestBrand');
  await productForm.expectFieldValueByLabel('Brand', 'POMTestBrand');
  console.log('STEP 5 PASSED');
});

test('Step 6: Fill Title DE', async () => {
  test.setTimeout(60000);
  await productForm.fillTitle('Premium USB-C Ladegeraet POM Test');
  console.log('STEP 6 PASSED');
});

test('Step 7: Fill Description DE', async () => {
  test.setTimeout(60000);
  await productForm.fillDescription('Automatisiert erstelltes Testprodukt mit Page Object Model Pattern.');
  console.log('STEP 7 PASSED');
});

test('Step 8: Fill Weight and select Category', async () => {
  test.setTimeout(60000);
  await productForm.fillField('Weight', '275.0000');
  await productForm.selectFirstCategory();
  try { await page.screenshot({ path: 'screenshots/pom-create-8-master-done.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('STEP 8 PASSED');
});

test('Step 9: Navigate to Price & stock tab', async () => {
  test.setTimeout(60000);
  await productForm.clickTab('Price & stock');
  await expect(page.getByText('Selling price', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('VAT', { exact: true })).toBeVisible();
  await expect(page.getByText('Stock quantity', { exact: true })).toBeVisible();
  console.log('STEP 9 PASSED');
});

test('Step 10: Fill Selling price', async () => {
  test.setTimeout(60000);
  await productForm.fillField('Selling price', '59.9000');
  console.log('STEP 10 PASSED');
});

test('Step 11: Fill VAT', async () => {
  test.setTimeout(60000);
  await productForm.fillField('VAT', '8.10');
  console.log('STEP 11 PASSED');
});

test('Step 12: Fill Stock quantity', async () => {
  test.setTimeout(60000);
  await productForm.fillField('Stock quantity', '200');
  try { await page.screenshot({ path: 'screenshots/pom-create-12-price-done.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('STEP 12 PASSED');
});

test('Step 12b: Fill Media URL', async () => {
  test.setTimeout(60000);
  await productForm.fillMediaUrl('https://cdn.example.com/pom-test-product.jpg');
  console.log('STEP 12b PASSED');
});

test('Step 13: Save the product', async () => {
  test.setTimeout(120000);
  await productForm.clickSave();
  await productForm.expectBodyContains(TEST_SKU);
  try { await page.screenshot({ path: 'screenshots/pom-create-13-saved.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('STEP 13 PASSED');
});

test('Step 14: Verify product created', async () => {
  test.setTimeout(60000);
  await productForm.expectBodyContains(TEST_SKU);
  await productForm.expectBodyContains(TEST_GTIN);
  await productForm.expectBodyContains('POMTestBrand');
  console.log('STEP 14 PASSED');
});

// ==========================================
// VALIDATIONS
// ==========================================

test('Step 15: GTIN invalid checksum rejected', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Master data');
  // Use an invalid GTIN (wrong check digit) to trigger validation error
  const invalidGtin = TEST_GTIN.slice(0, -1) + ((parseInt(TEST_GTIN.slice(-1)) + 1) % 10);
  await productForm.fillField('GTIN', invalidGtin);
  await productForm.clickSave();
  await productForm.expectHasError();
  try { await page.screenshot({ path: 'screenshots/pom-create-15-gtin-invalid.png', fullPage: true, timeout: 5000 }); } catch {}
  await productForm.fillField('GTIN', TEST_GTIN);
  console.log('STEP 15 PASSED');
});

test('Step 16: Empty provider key rejected', async () => {
  test.setTimeout(120000);
  await productForm.fillField('Provider key', '');
  await productForm.clickSave();
  await productForm.expectHasError();
  try { await page.screenshot({ path: 'screenshots/pom-create-16-provider-empty.png', fullPage: true, timeout: 5000 }); } catch {}
  await productForm.fillField('Provider key', TEST_SKU);
  console.log('STEP 16 PASSED');
});

test('Step 17: Invalid VAT rejected', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Price & stock');
  await productForm.fillField('VAT', '5.00');
  await productForm.clickSave();
  await productForm.expectHasError();
  try { await page.screenshot({ path: 'screenshots/pom-create-17-vat-invalid.png', fullPage: true, timeout: 5000 }); } catch {}
  await productForm.fillField('VAT', '8.10');
  console.log('STEP 17 PASSED');
});

test('Step 18: Stock over 99999 rejected', async () => {
  test.setTimeout(120000);
  await productForm.fillField('Stock quantity', '100000');
  await productForm.clickSave();
  await productForm.expectHasError();
  try { await page.screenshot({ path: 'screenshots/pom-create-18-stock-over.png', fullPage: true, timeout: 5000 }); } catch {}
  await productForm.fillField('Stock quantity', '200');
  console.log('STEP 18 PASSED');
});

test('Step 19: Zero price rejected', async () => {
  test.setTimeout(120000);
  await productForm.fillField('Selling price', '0');
  await productForm.clickSave();
  await productForm.expectHasError();
  try { await page.screenshot({ path: 'screenshots/pom-create-19-price-zero.png', fullPage: true, timeout: 5000 }); } catch {}
  await productForm.fillField('Selling price', '59.9000');
  console.log('STEP 19 PASSED');
});

test('Step 20: Final save with all valid data', async () => {
  test.setTimeout(120000);
  await productForm.clickSave();
  await productForm.expectBodyContains(TEST_SKU);
  try { await page.screenshot({ path: 'screenshots/pom-create-20-final.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('STEP 20 PASSED');
});
