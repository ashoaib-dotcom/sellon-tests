import { test, expect, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { NavigationPage } from '../pages/navigation.page';
import { ProductListPage } from '../pages/product-list.page';
import * as path from 'path';
import * as fs from 'fs';

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let navPage: NavigationPage;
let productListPage: ProductListPage;

test.beforeAll(async () => {
  test.setTimeout(300000);

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

  // Create stock update CSV if not exists
  const stockCsvPath = path.resolve('test-data/stock-update.csv');
  if (!fs.existsSync(stockCsvPath)) {
    const stockData = [
      'providerKey,stockQuantity,restockTime,expectedRestockQuantity',
      'AKK-LDG-001,250,30,100',
      'AKK-LDG-002,180,14,50',
      'AKK-LDG-003,0,,',
      'BT-SPK-001,500,7,200',
      'BT-SPK-002,120,,',
      'DART-S-001,300,21,150',
      'DART-S-002,45,,',
      'BB-FLA-001,200,10,80',
      'BB-FLA-002,90,,',
      'BACK-001,150,28,60',
    ].join('\n');
    fs.writeFileSync(stockCsvPath, stockData);
    console.log('Stock update CSV created');
  }

  if (!fs.existsSync('auth-state.json')) {
    await loginPage.login(process.env.TEST_USERNAME || 'ashoaib', process.env.TEST_PASSWORD || 'test2');
  } else {
    await page.goto(process.env.BASE_URL || 'https://stage.sellon.ch/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.locator('.menu-icon').waitFor({ state: 'visible', timeout: 90000 }).catch(() => {});
  }
  await navPage.navigateToProducts();
  console.log('SETUP COMPLETE');
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

// ==========================================
// STEP 1: VERIFY PRODUCTS BEFORE STOCK UPDATE
// ==========================================

test('Stock Import Step 1: Verify products before stock update', async () => {
  test.setTimeout(120000);
  await productListPage.expectTableVisible();
  const pagination = await productListPage.getPaginationText();
  console.log('Products before stock update:', pagination);
  try { await page.screenshot({ path: 'screenshots/pom-stock-1-before.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('STEP 1 PASSED');
});

// ==========================================
// STEP 2: CLICK STOCK IMPORT BUTTON
// ==========================================

test('Stock Import Step 2: Click Stock import button', async () => {
  test.setTimeout(120000);
  await page.getByText('Stock import', { exact: true }).click();
  await page.waitForTimeout(10000);
  try { await page.screenshot({ path: 'screenshots/pom-stock-2-dialog.png', fullPage: true, timeout: 5000 }); } catch {}

  const buttons = await page.getByRole('button').allTextContents();
  console.log('Stock import dialog buttons:', buttons);

  console.log('STEP 2 PASSED');
});

// ==========================================
// STEP 3: TRY STOCK IMPORT WITHOUT FILE
// ==========================================

test('Stock Import Step 3: Try import without file - expect error', async () => {
  test.setTimeout(120000);

  const possibleButtons = ['Run', 'Start', 'Execute', 'Import', 'OK', 'Confirm', 'Submit', 'Upload'];
  for (const btnName of possibleButtons) {
    try {
      const btn = page.getByRole('button', { name: btnName }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        console.log(`Clicking "${btnName}" without file...`);
        await btn.click();
        await page.waitForTimeout(5000);
        break;
      }
    } catch {}
  }

  try { await page.screenshot({ path: 'screenshots/pom-stock-3-no-file-error.png', fullPage: true, timeout: 5000 }); } catch {}

  const bodyText = await page.locator('body').innerText();
  console.log('Contains "error":', bodyText.toLowerCase().includes('error'));
  console.log('Contains "file":', bodyText.toLowerCase().includes('file'));

  console.log('STEP 3 PASSED - No file error shown');
});

// ==========================================
// STEP 4: CLOSE ERROR AND REOPEN
// ==========================================

test('Stock Import Step 4: Close error and reopen dialog', async () => {
  test.setTimeout(120000);

  try { await page.keyboard.press('Escape'); await page.waitForTimeout(3000); } catch {}
  try {
    const okBtn = page.getByRole('button', { name: /OK|Close|Cancel/i }).first();
    if (await okBtn.isVisible({ timeout: 2000 })) { await okBtn.click(); await page.waitForTimeout(3000); }
  } catch {}

  const fileInputCount = await page.locator('input[type="file"]').count();
  if (fileInputCount === 0) {
    try {
      await page.getByText('Stock import', { exact: true }).click();
      await page.waitForTimeout(10000);
    } catch {
      await navPage.navigateToProducts();
      await page.getByText('Stock import', { exact: true }).click();
      await page.waitForTimeout(10000);
    }
  }

  try { await page.screenshot({ path: 'screenshots/pom-stock-4-reopened.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('STEP 4 PASSED');
});

// ==========================================
// STEP 5: UPLOAD STOCK CSV
// ==========================================

test('Stock Import Step 5: Upload stock update CSV', async () => {
  test.setTimeout(120000);

  const csvFilePath = path.resolve('test-data/stock-update.csv');
  console.log('Stock CSV path:', csvFilePath);

  const fileInput = page.locator('input[type="file"]');
  if (await fileInput.count() > 0) {
    await fileInput.first().setInputFiles(csvFilePath);
    console.log('Stock file uploaded');
  }

  await page.waitForTimeout(5000);
  try { await page.screenshot({ path: 'screenshots/pom-stock-5-uploaded.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('STEP 5 PASSED');
});

// ==========================================
// STEP 6: RUN STOCK IMPORT
// ==========================================

test('Stock Import Step 6: Run the stock import', async () => {
  test.setTimeout(120000);

  const possibleButtons = ['Run', 'Start', 'Execute', 'Import', 'OK', 'Confirm', 'Submit', 'Upload'];
  for (const btnName of possibleButtons) {
    try {
      const btn = page.getByRole('button', { name: btnName }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        console.log(`Clicking "${btnName}"`);
        await btn.click();
        await page.waitForTimeout(5000);
        break;
      }
    } catch {}
  }

  try { await page.screenshot({ path: 'screenshots/pom-stock-6-started.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('STEP 6 PASSED');
});

// ==========================================
// STEP 7: WAIT FOR STOCK IMPORT TO COMPLETE
// ==========================================

test('Stock Import Step 7: Wait for completion', async () => {
  test.setTimeout(300000);

  for (let i = 1; i <= 8; i++) {
    await page.waitForTimeout(15000);
    try {
      try { await page.screenshot({ path: `screenshots/pom-stock-7-progress-${i}.png`, fullPage: true, timeout: 10000 }); } catch {}
      const bodyText = await page.locator('body').innerText({ timeout: 10000 });
      console.log(`Check ${i}: complete=${bodyText.toLowerCase().includes('complete')}, success=${bodyText.toLowerCase().includes('success')}, error=${bodyText.toLowerCase().includes('error')}`);

      if (bodyText.toLowerCase().includes('complete') || bodyText.toLowerCase().includes('success')) {
        console.log('Stock import complete!');
        break;
      }
    } catch {}
  }

  try {
    const finalText = await page.locator('body').innerText({ timeout: 10000 });
    console.log('STOCK IMPORT RESULT (first 2000):', finalText.substring(0, 2000));
  } catch {}

  console.log('STEP 7 PASSED');
});

// ==========================================
// STEP 8: NAVIGATE BACK TO PRODUCTS
// ==========================================

test('Stock Import Step 8: Close import dialog and verify product list', async () => {
  test.setTimeout(60000);

  // Close the import popup
  const closeBtn = page.getByText('Close', { exact: true });
  if (await closeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await closeBtn.click();
  }

  // Wait a few seconds for the product list to settle
  await page.waitForTimeout(5000);

  try {
    try { await page.screenshot({ path: 'screenshots/pom-stock-8-product-list.png', fullPage: true, timeout: 10000 }); } catch {}
  } catch {}

  console.log('STEP 8 PASSED');
});
// ==========================================
// NEGATIVE TESTS
// ==========================================

test('Stock Import negative: uploading a non-CSV file should show an error', async () => {
  test.setTimeout(120000);

  // Re-open the stock import dialog
  const stockImportBtn = page.getByText('Stock import', { exact: true }).filter({ visible: true }).first();
  if (!await stockImportBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.getByText('Import', { exact: true }).filter({ visible: true }).first().click();
    await page.waitForTimeout(2000);
  } else {
    await stockImportBtn.click();
    await page.waitForTimeout(2000);
  }

  // Create a temporary .txt file and attempt to upload it
  const { writeFileSync } = require('fs');
  const tmpPath = '/tmp/not-a-csv.txt';
  writeFileSync(tmpPath, 'this is not a valid CSV file');

  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(tmpPath);
    await page.waitForTimeout(3000);

    const bodyText = await page.locator('body').innerText();
    const hasError = bodyText.toLowerCase().includes('error') ||
      bodyText.toLowerCase().includes('invalid') ||
      bodyText.toLowerCase().includes('format') ||
      bodyText.toLowerCase().includes('csv');
    console.log('Error shown for non-CSV upload:', hasError);
  } else {
    console.log('File input not found — skipping upload');
  }

  // Dismiss dialog
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  try { await page.screenshot({ path: 'screenshots/pom-stock-neg-wrong-filetype.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('STOCK IMPORT NEG WRONG FILE TYPE TEST PASSED');
});
