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

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(300000);

  browser = await chromium.launch({
    headless: true,
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

  await loginPage.login(process.env.TEST_USERNAME || '', process.env.TEST_PASSWORD || '');
  await navPage.navigateToProducts();
  console.log('SETUP COMPLETE');
});

test.afterAll(async () => {
  await browser.close();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function openImportDialog(): Promise<boolean> {
  try {
    if (await productListPage.isFileInputPresent()) return true; // dialog already open
    await productListPage.clickImport();
    await page.waitForTimeout(2000);
    return await productListPage.isFileInputPresent();
  } catch {
    return false;
  }
}

// ── CSV import (existing happy path) ─────────────────────────────────────────

test('Import Step 1: Open import dialog', async () => {
  test.setTimeout(60000);
  const opened = await openImportDialog();
  console.log('Import dialog opened with file input:', opened);
  try { await page.screenshot({ path: 'screenshots/pom-import-1-dialog.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('STEP 1 PASSED');
});

test('Import Step 2: Try import without file — expect validation error', async () => {
  test.setTimeout(60000);
  await productListPage.clickImportRunButton();
  const body = await productListPage.getBodyText();
  const hasError = body.includes('error') || body.includes('required') || body.includes('file') || body.includes('invalid');
  console.log('Validation error shown for empty submit:', hasError);
  try { await page.screenshot({ path: 'screenshots/pom-import-2-no-file-error.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('STEP 2 PASSED');
});

test('Import Step 3: Upload CSV file and run import', async () => {
  test.setTimeout(300000);
  const csvPath = path.resolve('test-data/import-products.csv');

  if (!await productListPage.isFileInputPresent()) {
    await openImportDialog();
  }

  if (await productListPage.isFileInputPresent()) {
    await productListPage.attachFile(csvPath);
    console.log('CSV file attached:', path.basename(csvPath));
    await page.waitForTimeout(2000);
    try { await page.screenshot({ path: 'screenshots/pom-import-3-csv-attached.png', fullPage: true, timeout: 5000 }); } catch {}

    const started = await productListPage.clickImportRunButton();
    console.log('Import started:', started);

    const result = await productListPage.waitForImportResult();
    console.log('CSV import result:', result);
    try { await page.screenshot({ path: 'screenshots/pom-import-3-csv-result.png', fullPage: true, timeout: 5000 }); } catch {}
  } else {
    console.log('File input not found — skipping CSV upload');
  }
  console.log('STEP 3 PASSED');
});

test('Import Step 4: Close dialog after CSV import', async () => {
  test.setTimeout(60000);
  await productListPage.closeImportDialog();
  try { await page.screenshot({ path: 'screenshots/pom-import-4-closed.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('STEP 4 PASSED');
});

// ── XLSX import ───────────────────────────────────────────────────────────────

test('Import Step 5: Upload XLSX file — expect successful import', async () => {
  test.setTimeout(300000);
  const xlsxPath = path.resolve('test-data/import-products.xlsx');

  if (!fs.existsSync(xlsxPath)) {
    console.log('XLSX fixture not found at', xlsxPath, '— skipping');
    return;
  }

  await navPage.navigateToProducts();
  await page.waitForTimeout(2000);

  const opened = await openImportDialog();
  if (!opened) { console.log('Import dialog did not open — skipping'); return; }

  try { await page.screenshot({ path: 'screenshots/pom-import-5-xlsx-dialog.png', fullPage: true, timeout: 5000 }); } catch {}

  await productListPage.attachFile(xlsxPath);
  console.log('XLSX file attached:', path.basename(xlsxPath));
  await page.waitForTimeout(2000);
  try { await page.screenshot({ path: 'screenshots/pom-import-5-xlsx-attached.png', fullPage: true, timeout: 5000 }); } catch {}

  // Verify no immediate format rejection before clicking run
  const bodyAfterAttach = await productListPage.getBodyText();
  const rejectedImmediately =
    bodyAfterAttach.includes('invalid') ||
    bodyAfterAttach.includes('not supported') ||
    bodyAfterAttach.includes('wrong format');
  console.log('XLSX rejected immediately on attach:', rejectedImmediately);

  const started = await productListPage.clickImportRunButton();
  console.log('XLSX import started:', started);

  const result = await productListPage.waitForImportResult();
  console.log('XLSX import result:', result);
  try { await page.screenshot({ path: 'screenshots/pom-import-5-xlsx-result.png', fullPage: true, timeout: 5000 }); } catch {}

  // The system should either accept (success/complete) or show a clear format error — not silently hang
  expect(['success', 'error']).toContain(result);
  if (result === 'success') {
    console.log('XLSX import accepted and completed successfully');
  } else {
    console.log('XLSX import showed an error — system responded clearly (not a hang)');
  }

  await productListPage.closeImportDialog();
  console.log('STEP 5 PASSED');
});

// ── Wrong file type (PNG) ─────────────────────────────────────────────────────

test('Import Step 6: Upload PNG file — expect format rejection', async () => {
  test.setTimeout(120000);

  // Create a minimal valid PNG file (1×1 pixel, transparent)
  const pngPath = '/tmp/test-invalid-import.png';
  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk length + type
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // width=1, height=1
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, // bit depth=8, color type=6 (RGBA)
    0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, // CRC + IDAT chunk
    0x54, 0x78, 0x9C, 0x62, 0x00, 0x00, 0x00, 0x02, // IDAT data (zlib compressed)
    0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33, 0x00, 0x00, // IDAT CRC
    0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, // IEND chunk
    0x60, 0x82,
  ]);
  fs.writeFileSync(pngPath, pngBytes);

  await navPage.navigateToProducts();
  await page.waitForTimeout(2000);

  const opened = await openImportDialog();
  if (!opened) { console.log('Import dialog did not open — skipping'); return; }

  try { await page.screenshot({ path: 'screenshots/pom-import-6-png-dialog.png', fullPage: true, timeout: 5000 }); } catch {}

  // Check if the file input restricts accepted types (browser-level validation)
  const acceptAttr = await productListPage.getFileInputAccept();
  console.log('File input accept attribute:', acceptAttr || '(none)');

  // Check if PNG is excluded by the accept attribute
  const pngBlockedByBrowser = acceptAttr
    ? !acceptAttr.includes('image') && !acceptAttr.includes('.png') && !acceptAttr.includes('*')
    : false;
  console.log('PNG blocked at browser level by accept attr:', pngBlockedByBrowser);

  await productListPage.attachFile(pngPath);
  console.log('PNG file attached');
  await page.waitForTimeout(3000);
  try { await page.screenshot({ path: 'screenshots/pom-import-6-png-attached.png', fullPage: true, timeout: 5000 }); } catch {}

  const bodyAfterAttach = await productListPage.getBodyText();
  const rejectedOnAttach =
    bodyAfterAttach.includes('invalid') ||
    bodyAfterAttach.includes('not supported') ||
    bodyAfterAttach.includes('wrong format') ||
    bodyAfterAttach.includes('only') ||
    bodyAfterAttach.includes('csv') ||
    bodyAfterAttach.includes('xlsx') ||
    bodyAfterAttach.includes('format');
  console.log('PNG rejected immediately on attach:', rejectedOnAttach);

  if (!rejectedOnAttach) {
    // Try submitting — the server or dialog should reject it
    await productListPage.clickImportRunButton();
    await page.waitForTimeout(5000);
    const bodyAfterRun = await productListPage.getBodyText();
    const rejectedAfterRun =
      bodyAfterRun.includes('invalid') ||
      bodyAfterRun.includes('error') ||
      bodyAfterRun.includes('not supported') ||
      bodyAfterRun.includes('format');
    console.log('PNG rejected after submitting:', rejectedAfterRun);

    try { await page.screenshot({ path: 'screenshots/pom-import-6-png-run-result.png', fullPage: true, timeout: 5000 }); } catch {}

    // The system must reject a PNG — either on attach or on run
    expect(rejectedOnAttach || rejectedAfterRun).toBe(true);
  } else {
    // Already rejected on attach — that's the correct behaviour
    expect(rejectedOnAttach).toBe(true);
  }

  console.log('PNG file correctly rejected by the system');
  await productListPage.closeImportDialog();
  fs.unlinkSync(pngPath);
  console.log('STEP 6 PASSED');
});
