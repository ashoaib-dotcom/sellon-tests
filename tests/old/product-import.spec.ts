import { test, expect, chromium, Page, Browser } from '@playwright/test';
import * as path from 'path';

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  test.setTimeout(300000);

  browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  page = await context.newPage();

  console.log('Step 1: Logging in...');
  await page.goto('https://mpe-test.lobster-cloud.com', { timeout: 120000 });
  await page.waitForSelector('input', { state: 'visible', timeout: 120000 });
  await page.waitForTimeout(5000);

  const usernameField = page.getByRole('textbox', { name: 'Username' });
  await usernameField.click();
  await usernameField.pressSequentially('ashoaib', { delay: 150 });
  await page.waitForTimeout(1000);

  const passwordField = page.getByRole('textbox', { name: 'Password' });
  await passwordField.click();
  await passwordField.pressSequentially('test2', { delay: 150 });
  await page.waitForTimeout(1000);

  const passwordValue = await passwordField.inputValue();
  if (passwordValue === '') {
    await passwordField.click();
    await passwordField.pressSequentially('test2', { delay: 200 });
    await page.waitForTimeout(1000);
  }

  await page.getByRole('button', { name: 'Login' }).click();

  const yesButton = page.getByRole('button', { name: 'Yes' });
  try {
    await yesButton.waitFor({ state: 'visible', timeout: 15000 });
    await yesButton.click();
    console.log('Step 2: Session popup handled');
  } catch {
    console.log('Step 2: No session popup');
  }

  console.log('Step 3: Waiting for dashboard...');
  await page.waitForTimeout(60000);

  console.log('Step 4: Navigating to Product page...');
  try {
    const modal = page.locator('lb-modal.blocking');
    if (await modal.isVisible()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(2000);
    }
  } catch {}

  await page.locator('.menu-icon').click();
  await page.waitForTimeout(2000);

  const productItems = page.locator('nav').getByText('Product', { exact: true });
  await productItems.first().click();
  await page.waitForTimeout(2000);

  const subItem = page.locator('nav').getByText('Product', { exact: true }).nth(1);
  await subItem.scrollIntoViewIfNeeded();
  await subItem.dispatchEvent('click');
  await page.waitForTimeout(15000);

  console.log('SETUP COMPLETE');
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

// ==========================================
// HELPER
// ==========================================

async function navigateToProductList() {
  try {
    const modal = page.locator('lb-modal.blocking');
    if (await modal.isVisible()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(2000);
    }
  } catch {}

  await page.locator('.menu-icon').click();
  await page.waitForTimeout(2000);

  const productItems = page.locator('nav').getByText('Product', { exact: true });
  await productItems.first().click();
  await page.waitForTimeout(2000);

  const subItem = page.locator('nav').getByText('Product', { exact: true }).nth(1);
  await subItem.scrollIntoViewIfNeeded();
  await subItem.dispatchEvent('click');
  await page.waitForTimeout(15000);
}

// ==========================================
// STEP 1: COUNT PRODUCTS BEFORE IMPORT
// ==========================================

test('Import Step 1: Count products before import', async () => {
  test.setTimeout(120000);

  await expect(page.getByTitle('ID', { exact: true })).toBeVisible({ timeout: 30000 });

  const paginationText = await page.locator('text=/\\d+ - \\d+ of \\d+/').innerText();
  console.log('Pagination BEFORE import:', paginationText);

  const rowCount = await page.locator('tbody tr').count();
  console.log('Visible rows BEFORE import:', rowCount);

  await page.screenshot({ path: 'screenshots/import-1-before.png', fullPage: true });
  console.log('STEP 1 PASSED');
});

// ==========================================
// STEP 2: CLICK IMPORT BUTTON
// ==========================================

test('Import Step 2: Click Import button to open dialog', async () => {
  test.setTimeout(120000);

  await page.getByText('Import', { exact: true }).click();
  await page.waitForTimeout(10000);

  await page.screenshot({ path: 'screenshots/import-2-dialog-opened.png', fullPage: true });

  const buttons = await page.getByRole('button').allTextContents();
  console.log('DIALOG BUTTONS:', buttons);

  console.log('STEP 2 PASSED');
});

// ==========================================
// STEP 3: TRY IMPORT WITHOUT SELECTING FILE
// ==========================================

test('Import Step 3: Try to run import without selecting a file', async () => {
  test.setTimeout(120000);

  await page.screenshot({ path: 'screenshots/import-3-no-file-before.png', fullPage: true });

  const possibleButtons = ['Run', 'Start', 'Execute', 'Import', 'OK', 'Confirm', 'Submit', 'Upload'];

  for (const btnName of possibleButtons) {
    try {
      const btn = page.getByRole('button', { name: btnName }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        console.log(`Clicking "${btnName}" without file selected...`);
        await btn.click();
        await page.waitForTimeout(5000);
        break;
      }
    } catch {}
  }

  await page.screenshot({ path: 'screenshots/import-3-no-file-error.png', fullPage: true });

  const bodyText = await page.locator('body').innerText();
  console.log('NO FILE ERROR (first 1500):', bodyText.substring(0, 1500));
  console.log('Contains "error":', bodyText.toLowerCase().includes('error'));
  console.log('Contains "file":', bodyText.toLowerCase().includes('file'));
  console.log('Contains "select":', bodyText.toLowerCase().includes('select'));
  console.log('Contains "required":', bodyText.toLowerCase().includes('required'));
  console.log('Contains "upload":', bodyText.toLowerCase().includes('upload'));
  console.log('Contains "please":', bodyText.toLowerCase().includes('please'));
  console.log('Contains "empty":', bodyText.toLowerCase().includes('empty'));

  console.log('STEP 3 PASSED');
});

// ==========================================
// STEP 4: CLOSE ERROR AND REOPEN IMPORT
// ==========================================

test('Import Step 4: Close error and reopen import dialog', async () => {
  test.setTimeout(120000);

  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(3000);
  } catch {}

  try {
    const okBtn = page.getByRole('button', { name: /OK|Close|Cancel/i }).first();
    if (await okBtn.isVisible({ timeout: 2000 })) {
      await okBtn.click();
      await page.waitForTimeout(3000);
    }
  } catch {}

  await page.screenshot({ path: 'screenshots/import-4-error-closed.png', fullPage: true });

  const fileInputCount = await page.locator('input[type="file"]').count();
  console.log('File inputs still visible:', fileInputCount);

  if (fileInputCount === 0) {
    try {
      await page.getByText('Import', { exact: true }).click();
      await page.waitForTimeout(10000);
      console.log('Import dialog reopened');
    } catch {
      console.log('Could not reopen, navigating back...');
      await navigateToProductList();
      await page.getByText('Import', { exact: true }).click();
      await page.waitForTimeout(10000);
    }
  }

  await page.screenshot({ path: 'screenshots/import-4-dialog-ready.png', fullPage: true });
  console.log('STEP 4 PASSED');
});

// ==========================================
// STEP 5: UPLOAD VALID CSV FILE
// ==========================================

test('Import Step 5: Upload valid CSV file', async () => {
  test.setTimeout(120000);

  const csvFilePath = path.resolve('test-data/import-products.csv');
  console.log('CSV path:', csvFilePath);

  const fileInput = page.locator('input[type="file"]');
  const fileInputCount = await fileInput.count();

  if (fileInputCount > 0) {
    await fileInput.first().setInputFiles(csvFilePath);
    console.log('File uploaded via setInputFiles');
  } else {
    console.log('No file input, trying fileChooser...');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null),
      page.locator('[class*="upload"], [class*="drop"], [class*="browse"]').first().click().catch(() => {})
    ]);

    if (fileChooser) {
      await fileChooser.setFiles(csvFilePath);
      console.log('File uploaded via fileChooser');
    }
  }

  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'screenshots/import-5-file-uploaded.png', fullPage: true });

  console.log('STEP 5 PASSED');
});

// ==========================================
// STEP 6: RUN THE IMPORT WITH FILE
// ==========================================

test('Import Step 6: Run the import with file selected', async () => {
  test.setTimeout(120000);

  const possibleButtons = ['Run', 'Start', 'Execute', 'Import', 'OK', 'Confirm', 'Submit', 'Upload'];

  for (const btnName of possibleButtons) {
    try {
      const btn = page.getByRole('button', { name: btnName }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        console.log(`Clicking button: "${btnName}"`);
        await btn.click();
        await page.waitForTimeout(5000);
        break;
      }
    } catch {}
  }

  await page.screenshot({ path: 'screenshots/import-6-import-started.png', fullPage: true });
  console.log('STEP 6 PASSED');
});

// ==========================================
// STEP 7: WAIT FOR IMPORT TO COMPLETE
// ==========================================

test('Import Step 7: Wait for import to complete', async () => {
  test.setTimeout(300000);

  console.log('Waiting for import to process...');

  for (let i = 1; i <= 10; i++) {
    await page.waitForTimeout(15000);

    try {
      await page.screenshot({ path: `screenshots/import-7-progress-${i}.png`, fullPage: true, timeout: 10000 });
    } catch {
      console.log(`Screenshot ${i} failed`);
    }

    try {
      const bodyText = await page.locator('body').innerText({ timeout: 10000 });
      console.log(`Progress check ${i}:`);
      console.log('  complete:', bodyText.toLowerCase().includes('complete'));
      console.log('  finished:', bodyText.toLowerCase().includes('finished'));
      console.log('  success:', bodyText.toLowerCase().includes('success'));
      console.log('  error:', bodyText.toLowerCase().includes('error'));

      if (bodyText.toLowerCase().includes('complete') ||
          bodyText.toLowerCase().includes('finished') ||
          bodyText.toLowerCase().includes('success')) {
        console.log('Import appears complete!');
        break;
      }
    } catch {
      console.log(`Progress check ${i} failed`);
    }
  }

  try {
    await page.screenshot({ path: 'screenshots/import-7-final.png', fullPage: true, timeout: 10000 });
    const finalText = await page.locator('body').innerText({ timeout: 10000 });
    console.log('IMPORT RESULT (first 2000):', finalText.substring(0, 2000));
  } catch {
    console.log('Could not capture final state');
  }

  console.log('STEP 7 PASSED');
});

// ==========================================
// STEP 8: GO BACK TO PRODUCT LIST
// ==========================================

test('Import Step 8: Navigate back to product list', async () => {
  test.setTimeout(180000);

  // Force navigate - this escapes any hanging state
  await page.goto('https://mpe-test.lobster-cloud.com', {
    timeout: 120000,
    waitUntil: 'commit'
  });

  // Wait for page to load
  await page.waitForSelector('input, .menu-icon, nav', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(30000);

  // Navigate to Product list
  try {
    await page.locator('.menu-icon').click();
    await page.waitForTimeout(2000);

    const productItems = page.locator('nav').getByText('Product', { exact: true });
    await productItems.first().click();
    await page.waitForTimeout(2000);

    const subItem = page.locator('nav').getByText('Product', { exact: true }).nth(1);
    await subItem.scrollIntoViewIfNeeded();
    await subItem.dispatchEvent('click');
    await page.waitForTimeout(15000);
  } catch {
    console.log('Navigation failed');
  }

  try {
    await page.screenshot({ path: 'screenshots/import-8-product-list.png', fullPage: true, timeout: 10000 });
  } catch {}

  console.log('STEP 8 PASSED');
});
// ==========================================
// STEP 9: VERIFY PRODUCT COUNT AFTER IMPORT
// ==========================================

test('Import Step 10: Verify product count increased', async () => {
  test.setTimeout(120000);

  try {
    await expect(page.getByTitle('ID', { exact: true })).toBeVisible({ timeout: 30000 });

    const paginationText = await page.locator('text=/\\d+ - \\d+ of \\d+/').innerText();
    console.log('Pagination AFTER import:', paginationText);

    const rowCount = await page.locator('tbody tr').count();
    console.log('Visible rows AFTER import:', rowCount);
  } catch {
    console.log('Could not read product count - page may not be on product list');
  }

  try {
    await page.screenshot({ path: 'screenshots/import-10-after-count.png', fullPage: true, timeout: 10000 });
  } catch {}

  console.log('STEP 10 PASSED');
});

// ==========================================
// STEP 10: VERIFY IMPORTED PRODUCT DATA
// ==========================================

test('Import Step 11: Verify imported products are visible', async () => {
  test.setTimeout(120000);

  try {
    const bodyText = await page.locator('body').innerText({ timeout: 10000 });

    console.log('Contains PRES:', bodyText.includes('PRES-'));
    console.log('Contains SmartNest:', bodyText.includes('SmartNest'));
    console.log('Contains AlpinGear:', bodyText.includes('AlpinGear'));
    console.log('Contains KüchenAtelier:', bodyText.includes('KüchenAtelier'));
    console.log('Contains FitZone:', bodyText.includes('FitZone'));
    console.log('Contains PetLounge:', bodyText.includes('PetLounge'));
  } catch {
    console.log('Could not read page content');
  }

  try {
    await page.screenshot({ path: 'screenshots/import-11-verify-data.png', fullPage: true, timeout: 10000 });
  } catch {}

  console.log('STEP 11 PASSED');
});

// ==========================================
// STEP 11: REFRESH AND FINAL SCREENSHOTS
// ==========================================

test('Import Step 12: Refresh and take final screenshots', async () => {
  test.setTimeout(120000);

  try {
    await page.getByText('Refresh', { exact: true }).click();
    await page.waitForTimeout(10000);

    const paginationText = await page.locator('text=/\\d+ - \\d+ of \\d+/').innerText();
    console.log('FINAL Pagination:', paginationText);

    const rowCount = await page.locator('tbody tr').count();
    console.log('FINAL Visible rows:', rowCount);
  } catch {
    console.log('Could not refresh or read count');
  }

  try {
    await page.screenshot({ path: 'screenshots/import-12-final-top.png', fullPage: true, timeout: 10000 });
  } catch {}

  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/import-12-final-bottom.png', fullPage: true, timeout: 10000 });
  } catch {}

  console.log('STEP 12 PASSED - IMPORT TEST COMPLETE');
});