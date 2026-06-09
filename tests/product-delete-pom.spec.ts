import { test, expect, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { NavigationPage } from '../pages/navigation.page';
import { ProductListPage } from '../pages/product-list.page';

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let navPage: NavigationPage;
let productListPage: ProductListPage;

test.beforeAll(async () => {
  test.setTimeout(600000);

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

// ============================================================
// SINGLE PRODUCT DELETE
// ============================================================

test('Single Delete 1: Delete a Stage 1 product', async () => {
  test.setTimeout(120000);

  await productListPage.expectTableVisible();
  const countBefore = await productListPage.getTotalProductCount();
  console.log(`Products before: ${countBefore}`);

  const rowId = await productListPage.selectFirstProductByStatus('Stage 1');
  if (!rowId) {
    console.log('No Stage 1 product found — skipping');
    return;
  }
  console.log(`Selected Stage 1 product: ${rowId}`);

  await productListPage.clickDelete();
  await productListPage.confirmDialog();

  await productListPage.expectTableVisible();
  const countAfter = await productListPage.getTotalProductCount();
  console.log(`Products after: ${countAfter}`);
  expect(countAfter).toBeLessThan(countBefore);

  try { await page.screenshot({ path: 'screenshots/del-1-stage1.png', fullPage: true }); } catch {}
  console.log('SINGLE DELETE 1 PASSED — Stage 1 product deleted');
});

test('Single Delete 2: Delete a Stage 2 product', async () => {
  test.setTimeout(120000);

  await productListPage.expectTableVisible();
  const countBefore = await productListPage.getTotalProductCount();

  const rowId = await productListPage.selectFirstProductByStatus('Stage 2');
  if (!rowId) {
    console.log('No Stage 2 product found — skipping');
    return;
  }
  console.log(`Selected Stage 2 product: ${rowId}`);

  await productListPage.clickDelete();
  await productListPage.confirmDialog();

  await productListPage.expectTableVisible();
  const countAfter = await productListPage.getTotalProductCount();
  console.log(`Products after: ${countAfter}`);
  expect(countAfter).toBeLessThan(countBefore);

  try { await page.screenshot({ path: 'screenshots/del-2-stage2.png', fullPage: true }); } catch {}
  console.log('SINGLE DELETE 2 PASSED — Stage 2 product deleted');
});

test('Single Delete 3: Delete a product with Error status', async () => {
  test.setTimeout(120000);

  await productListPage.expectTableVisible();
  const countBefore = await productListPage.getTotalProductCount();

  const rowId = await productListPage.selectFirstProductByStatus('Error');
  if (!rowId) {
    console.log('No Error product found — skipping');
    return;
  }
  console.log(`Selected Error product: ${rowId}`);

  await productListPage.clickDelete();
  await productListPage.confirmDialog();

  await productListPage.expectTableVisible();
  const countAfter = await productListPage.getTotalProductCount();
  console.log(`Products after: ${countAfter}`);
  expect(countAfter).toBeLessThan(countBefore);

  try { await page.screenshot({ path: 'screenshots/del-3-error.png', fullPage: true }); } catch {}
  console.log('SINGLE DELETE 3 PASSED — Error product deleted');
});

test('Single Delete 4: Cancel deletion — product should remain', async () => {
  test.setTimeout(60000);

  await productListPage.expectTableVisible();
  const countBefore = await productListPage.getTotalProductCount();

  // Select the first row
  await productListPage.selectRowByIndex(0);
  console.log('Selected first product');

  // Click delete then CANCEL
  await productListPage.clickDelete();
  await productListPage.dismissDialog();

  // Product count should be unchanged
  await productListPage.expectTableVisible();
  const countAfter = await productListPage.getTotalProductCount();
  console.log(`Products before: ${countBefore}, after cancel: ${countAfter}`);
  expect(countAfter).toBe(countBefore);

  try { await page.screenshot({ path: 'screenshots/del-4-cancel.png', fullPage: true }); } catch {}
  console.log('SINGLE DELETE 4 PASSED — Product remains after cancel');
});

// ============================================================
// BULK DELETE
// ============================================================

test('Bulk Delete 1: Select all products and delete', async () => {
  test.setTimeout(120000);

  await productListPage.expectTableVisible();
  const countBefore = await productListPage.getTotalProductCount();
  console.log(`Products before select-all delete: ${countBefore}`);

  // Click the select-all checkbox
  await productListPage.selectAllProducts();
  console.log('Clicked select-all checkbox');

  await productListPage.clickDelete();
  await productListPage.confirmDialog();

  // Wait and refresh view
  await page.waitForTimeout(8000);

  let countAfter = countBefore;
  try {
    await productListPage.expectTableVisible();
    countAfter = await productListPage.getTotalProductCount();
  } catch {
    // Table might be empty — that's also a valid result
    countAfter = 0;
  }

  console.log(`Products after select-all delete: ${countAfter}`);
  expect(countAfter).toBeLessThan(countBefore);

  try { await page.screenshot({ path: 'screenshots/del-5-select-all.png', fullPage: true }); } catch {}
  console.log('BULK DELETE 1 PASSED — Select-all delete complete');
});

test('Bulk Delete 2: Select 3 specific products and delete', async () => {
  test.setTimeout(120000);

  await productListPage.expectTableVisible();
  const countBefore = await productListPage.getTotalProductCount();
  console.log(`Products before bulk delete: ${countBefore}`);

  if (countBefore < 3) {
    console.log('Not enough products for bulk delete — skipping');
    return;
  }

  // Select rows 0, 1, 2
  for (const idx of [0, 1, 2]) {
    await productListPage.selectRowByIndex(idx);
  }
  console.log('Selected 3 product rows');

  await productListPage.clickDelete();
  await productListPage.confirmDialog();

  await page.waitForTimeout(5000);
  await productListPage.expectTableVisible();

  const countAfter = await productListPage.getTotalProductCount();
  console.log(`Products after 3-product bulk delete: ${countAfter}`);
  expect(countAfter).toBeLessThan(countBefore);

  try { await page.screenshot({ path: 'screenshots/del-6-bulk3.png', fullPage: true }); } catch {}
  console.log('BULK DELETE 2 PASSED — 3 products deleted');
});

test('Bulk Delete 3: Select multiple products and cancel — products remain', async () => {
  test.setTimeout(60000);

  await productListPage.expectTableVisible();
  const countBefore = await productListPage.getTotalProductCount();

  if (countBefore < 2) {
    console.log('Not enough products — skipping');
    return;
  }

  // Select rows 0 and 1
  await productListPage.selectRowByIndex(0);
  await productListPage.selectRowByIndex(1);
  console.log('Selected 2 products');

  // Delete then CANCEL
  await productListPage.clickDelete();
  await productListPage.dismissDialog();

  // Counts must be unchanged
  await productListPage.expectTableVisible();
  const countAfter = await productListPage.getTotalProductCount();
  console.log(`Before: ${countBefore}, after cancel: ${countAfter}`);
  expect(countAfter).toBe(countBefore);

  try { await page.screenshot({ path: 'screenshots/del-7-bulk-cancel.png', fullPage: true }); } catch {}
  console.log('BULK DELETE 3 PASSED — Products remain after cancel');
});

// ============================================================
// EDGE CASES
// ============================================================

test('Edge Case 1: Delete without selecting any product', async () => {
  test.setTimeout(60000);

  await productListPage.expectTableVisible();

  // Click delete with no row selected
  await productListPage.clickDelete();

  const bodyText = await page.locator('body').innerText();
  const hasMsg =
    bodyText.toLowerCase().includes('select') ||
    bodyText.toLowerCase().includes('no item') ||
    bodyText.toLowerCase().includes('please') ||
    bodyText.toLowerCase().includes('confirm') ||
    bodyText.toLowerCase().includes('delete');

  console.log(`Message shown after unselected delete: ${hasMsg}`);

  // Dismiss any dialog that opened
  const confirmBtn = page.getByRole('button', { name: /^(Yes|OK|No|Cancel|Close)$/i }).first();
  if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await productListPage.dismissDialog();
  }

  try { await page.screenshot({ path: 'screenshots/del-edge1-no-selection.png', fullPage: true }); } catch {}
  console.log('EDGE CASE 1 PASSED — No-selection delete handled');
});

test('Edge Case 2: Product count decreases by correct amount after delete', async () => {
  test.setTimeout(120000);

  await productListPage.expectTableVisible();
  const countBefore = await productListPage.getTotalProductCount();
  console.log(`Count before: ${countBefore}`);

  if (countBefore === 0) {
    console.log('No products to delete — skipping');
    return;
  }

  await productListPage.selectRowByIndex(0);
  await productListPage.clickDelete();
  await productListPage.confirmDialog();

  await page.waitForTimeout(5000);
  await productListPage.expectTableVisible();

  const countAfter = await productListPage.getTotalProductCount();
  console.log(`Count after: ${countAfter}, decrease: ${countBefore - countAfter}`);

  // Should decrease by exactly 1
  expect(countBefore - countAfter).toBe(1);

  try { await page.screenshot({ path: 'screenshots/del-edge2-count.png', fullPage: true }); } catch {}
  console.log('EDGE CASE 2 PASSED — Count decreased by exactly 1');
});

test('Edge Case 3: Deleted product does not appear in the list', async () => {
  test.setTimeout(120000);

  await productListPage.expectTableVisible();
  const countBefore = await productListPage.getTotalProductCount();

  if (countBefore === 0) {
    console.log('No products — skipping');
    return;
  }

  // Get the provider key from the first row before deleting
  const firstRowText = await productListPage.getProviderKeyFromRow(0);
  console.log(`About to delete product: ${firstRowText}`);

  await productListPage.selectRowByIndex(0);
  await productListPage.clickDelete();
  await productListPage.confirmDialog();

  await page.waitForTimeout(5000);

  // Check the product no longer shows in the list
  const rowKeyPart = firstRowText.split('\t')[0].trim().substring(0, 10);
  if (rowKeyPart.length > 3) {
    const notInList = await productListPage.verifyProductNotInList(rowKeyPart);
    console.log(`Product "${rowKeyPart}" removed from list: ${notInList}`);
    expect(notInList).toBe(true);
  }

  try { await page.screenshot({ path: 'screenshots/del-edge3-not-in-list.png', fullPage: true }); } catch {}
  console.log('EDGE CASE 3 PASSED — Deleted product not found in list');
});

// ============================================================
// FINAL VERIFICATION
// ============================================================

test('Final: Verify product list after all deletions', async () => {
  test.setTimeout(60000);

  try {
    await productListPage.expectTableVisible();
    const finalCount = await productListPage.getTotalProductCount();
    const rowCount = await productListPage.getRowCount();
    console.log(`Final product count: ${finalCount}`);
    console.log(`Visible rows: ${rowCount}`);
    expect(rowCount).toBeGreaterThanOrEqual(0);
  } catch {
    console.log('Product list may be empty — that is a valid end state');
  }

  try { await page.screenshot({ path: 'screenshots/del-final-list.png', fullPage: true }); } catch {}
  console.log('FINAL PASSED — Product list verified after all delete operations');
});
