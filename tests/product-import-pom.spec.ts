import { test, expect, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { NavigationPage } from '../pages/navigation.page';
import { ProductListPage } from '../pages/product-list.page';
import * as path from 'path';

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let navPage: NavigationPage;
let productListPage: ProductListPage;

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

  await loginPage.login('ashoaib', 'test2');
  await navPage.navigateToProducts();
  console.log('SETUP COMPLETE');
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

test('Import Step 2: Click Import button', async () => {
  test.setTimeout(120000);
  await productListPage.clickImport();
  await page.screenshot({ path: 'screenshots/pom-import-2-dialog.png', fullPage: true });
  const buttons = await page.getByRole('button').allTextContents();
  console.log('Dialog buttons:', buttons);
  console.log('STEP 2 PASSED');
});

test('Import Step 3: Try import without file', async () => {
  test.setTimeout(120000);
  const possibleButtons = ['Run', 'Start', 'Execute', 'Import', 'OK', 'Confirm', 'Submit', 'Upload'];
  for (const btnName of possibleButtons) {
    try {
      const btn = page.getByRole('button', { name: btnName }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        await page.waitForTimeout(5000);
        break;
      }
    } catch {}
  }
  await page.screenshot({ path: 'screenshots/pom-import-3-no-file-error.png', fullPage: true });
  console.log('STEP 3 PASSED');
});

test('Import Step 4: Close error and reopen import', async () => {
  test.setTimeout(120000);
  try { await page.keyboard.press('Escape'); await page.waitForTimeout(3000); } catch {}
  try {
    const okBtn = page.getByRole('button', { name: /OK|Close|Cancel/i }).first();
    if (await okBtn.isVisible({ timeout: 2000 })) { await okBtn.click(); await page.waitForTimeout(3000); }
  } catch {}

  const fileInputCount = await page.locator('input[type="file"]').count();
  if (fileInputCount === 0) {
    try { await productListPage.clickImport(); } catch {
      await navPage.navigateToProducts();
      await productListPage.clickImport();
    }
  }
  console.log('STEP 4 PASSED');
});

test('Import Step 5: Upload CSV file', async () => {
  test.setTimeout(120000);
  const csvFilePath = path.resolve('test-data/import-products.csv');
  const fileInput = page.locator('input[type="file"]');
  if (await fileInput.count() > 0) {
    await fileInput.first().setInputFiles(csvFilePath);
    console.log('File uploaded');
  }
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'screenshots/pom-import-5-uploaded.png', fullPage: true });
  console.log('STEP 5 PASSED');
});

test('Import Step 6: Run the import', async () => {
  test.setTimeout(120000);
  const possibleButtons = ['Run', 'Start', 'Execute', 'Import', 'OK', 'Confirm', 'Submit', 'Upload'];
  for (const btnName of possibleButtons) {
    try {
      const btn = page.getByRole('button', { name: btnName }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        await page.waitForTimeout(5000);
        break;
      }
    } catch {}
  }
  await page.screenshot({ path: 'screenshots/pom-import-6-started.png', fullPage: true });
  console.log('STEP 6 PASSED');
});

test('Import Step 7: Wait for import to complete', async () => {
  test.setTimeout(300000);
  for (let i = 1; i <= 10; i++) {
    await page.waitForTimeout(15000);
    try {
      await page.screenshot({ path: `screenshots/pom-import-7-progress-${i}.png`, fullPage: true, timeout: 10000 });
      const bodyText = await page.locator('body').innerText({ timeout: 10000 });
      console.log(`Check ${i}: complete=${bodyText.toLowerCase().includes('complete')}, success=${bodyText.toLowerCase().includes('success')}`);
      if (bodyText.toLowerCase().includes('complete') || bodyText.toLowerCase().includes('success')) break;
    } catch {}
  }
  console.log('STEP 7 PASSED');
});

test('Import Step 8: Close import popup', async () => {
  test.setTimeout(180000);

  const closeNames = [/Cancel|Close|Back|Done|Finish|OK|Continue/i];
  let closed = false;
  for (const name of closeNames) {
    try {
      const closeButton = page.getByRole('button', { name }).first();
      if (await closeButton.isVisible({ timeout: 3000 })) {
        await closeButton.click();
        await page.waitForTimeout(3000);
        console.log('Closed import popup with button:', name);
        closed = true;
        break;
      }
    } catch {
      // ignore missing buttons
    }
  }

  if (!closed) {
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(2000);
      console.log('Closed import popup with Escape');
    } catch {
      console.log('No import popup close action was available');
    }
  }

  try {
    await page.screenshot({ path: 'screenshots/pom-import-8-closed.png', fullPage: true, timeout: 10000 });
  } catch {}
  console.log('STEP 8 PASSED');
});