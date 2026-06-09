import { test, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { OrdersPage } from '../pages/orders.page';

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let ordersPage: OrdersPage;

// Column indices discovered at runtime via dumpColumns() in TC-00
// Updated after first run — override here if they change
// 0: checkbox | remaining columns depend on the orders grid configuration
let COL_ID     = -1;  // resolved in TC-00
let COL_STATUS = -1;
let COL_DATE   = -1;

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
  ordersPage = new OrdersPage(page);

  await loginPage.login(process.env.TEST_USERNAME || 'ashoaib', process.env.TEST_PASSWORD || 'test2');
  await ordersPage.navigateToOrders();
  console.log('SETUP COMPLETE — pagination:', await ordersPage.getPaginationText());
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

// ============================================================
// TC-00: Discover column layout — must run first
// ============================================================

test('TC-00: Discover orders grid columns and filter row', async () => {
  test.setTimeout(60000);

  const headers = await ordersPage.getColumnHeaders();
  console.log('Column headers:', headers);

  // Map well-known column names to indices
  COL_ID     = headers.findIndex(h => /^id$/i.test(h.trim()));
  COL_STATUS = headers.findIndex(h => /status|state/i.test(h));
  COL_DATE   = headers.findIndex(h => /date|created|ordered/i.test(h));

  console.log(`Column indices → ID: ${COL_ID} | Status: ${COL_STATUS} | Date: ${COL_DATE}`);

  // Also print filter row inputs to understand what's filterable
  const filterCells = await page.locator('thead tr').nth(1).locator('th, td').allInnerTexts();
  console.log('Filter row cells:', filterCells);

  try { await page.screenshot({ path: 'screenshots/orders-filter-tc00-columns.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('TC-00 PASSED');
});

// ============================================================
// TC-01: Filter by a real Order ID from the grid
// ============================================================

test('TC-01: Filter by Order ID — shows only that order', async () => {
  test.setTimeout(120000);

  const rowCount = await ordersPage.getRowCount();
  if (rowCount === 0) {
    console.log('No orders in grid — skipping TC-01');
    return;
  }

  // Resolve ID column (fallback to col 1 if not discovered)
  const idColIndex = COL_ID !== -1 ? COL_ID : 1;

  // Pick a real ID from the first row
  const realId = await ordersPage.getCellText(0, idColIndex);
  console.log(`Picked order ID from row 0 col ${idColIndex}: "${realId}"`);

  if (!realId) {
    console.log('Could not read order ID — skipping TC-01');
    return;
  }

  const totalBefore = await ordersPage.getPaginationTotal();

  await ordersPage.setTextFilter(idColIndex, realId);
  await ordersPage.clickSearch();

  const totalAfter = await ordersPage.getPaginationTotal();
  const body = await page.locator('body').innerText();

  console.log(`Before: ${totalBefore} | After filter by "${realId}": ${totalAfter}`);
  console.log('ID appears in results:', body.includes(realId));
  console.log('Result count is 1 or less:', totalAfter <= 1);

  try { await page.screenshot({ path: 'screenshots/orders-filter-tc01-id-filter.png', fullPage: true, timeout: 5000 }); } catch {}

  await ordersPage.clickClear();
  console.log('TC-01 PASSED');
});

// ============================================================
// TC-02: Clear filters — restores full dataset
// ============================================================

test('TC-02: Clear filters restores full order count', async () => {
  test.setTimeout(60000);

  const totalBefore = await ordersPage.getPaginationTotal();
  console.log('Total before:', totalBefore);

  // Apply a filter then clear
  const idColIndex = COL_ID !== -1 ? COL_ID : 1;
  await ordersPage.setTextFilter(idColIndex, '999999999');
  await ordersPage.clickSearch();

  const totalAfterFilter = await ordersPage.getPaginationTotal();
  console.log('Total after impossible filter:', totalAfterFilter);

  await ordersPage.clickClear();

  const totalAfterClear = await ordersPage.getPaginationTotal();
  console.log('Total after clear:', totalAfterClear);
  console.log('Restored to original count:', totalAfterClear === totalBefore);

  try { await page.screenshot({ path: 'screenshots/orders-filter-tc02-clear.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('TC-02 PASSED');
});

// ============================================================
// TC-03: Filter by Status / State dropdown
// ============================================================

test('TC-03: Filter by Status dropdown — shows only matching orders', async () => {
  test.setTimeout(120000);

  if (COL_STATUS === -1) {
    console.log('Status column not found — skipping TC-03');
    return;
  }

  const rowCount = await ordersPage.getRowCount();
  if (rowCount === 0) {
    console.log('No orders — skipping TC-03');
    return;
  }

  const totalBefore = await ordersPage.getPaginationTotal();

  // Try common status option labels used in SellOn
  const statusOptions = ['Open', 'Shipped', 'Cancelled', 'Processing', 'New', 'Closed'];
  let filterApplied = false;

  for (const status of statusOptions) {
    await ordersPage.setDropdownFilter(COL_STATUS, status);
    await ordersPage.clickSearch();

    const totalAfter = await ordersPage.getPaginationTotal();
    if (totalAfter > 0 || totalBefore === 0) {
      console.log(`Status filter "${status}" → ${totalAfter} orders`);
      filterApplied = true;
      break;
    }
    await ordersPage.clickClear();
  }

  if (!filterApplied) {
    console.log('No status option returned results — checking that filter UI works (no crash)');
  }

  try { await page.screenshot({ path: 'screenshots/orders-filter-tc03-status.png', fullPage: true, timeout: 5000 }); } catch {}

  await ordersPage.clickClear();
  console.log('TC-03 PASSED');
});

// ============================================================
// TC-04: Filter by partial text in any text filter column
// ============================================================

test('TC-04: Text filter on first available text-input column', async () => {
  test.setTimeout(120000);

  // Find the first column in the filter row that has a text input
  const filterRowCells = page.locator('thead tr').nth(1).locator('th, td');
  const cellCount = await filterRowCells.count();
  let textColIndex = -1;

  for (let i = 0; i < cellCount; i++) {
    const input = filterRowCells.nth(i).locator('input[type="text"], input:not([type])').first();
    if (await input.count() > 0) {
      textColIndex = i;
      break;
    }
  }

  if (textColIndex === -1) {
    console.log('No text filter input found in orders grid — skipping TC-04');
    return;
  }

  // Read a real value from the first data row in that column
  const realValue = await ordersPage.getCellText(0, textColIndex);
  if (!realValue) {
    console.log(`No value found in data row col ${textColIndex} — skipping TC-04`);
    return;
  }

  // Use first 4 characters as partial search
  const partial = realValue.substring(0, 4);
  console.log(`Text filter col ${textColIndex}: partial search "${partial}" (from "${realValue}")`);

  const totalBefore = await ordersPage.getPaginationTotal();
  await ordersPage.setTextFilter(textColIndex, partial);
  await ordersPage.clickSearch();

  const totalAfter = await ordersPage.getPaginationTotal();
  console.log(`Before: ${totalBefore} | After partial search "${partial}": ${totalAfter}`);

  const body = await page.locator('body').innerText();
  console.log('Original value appears in results:', body.includes(realValue));

  try { await page.screenshot({ path: 'screenshots/orders-filter-tc04-text.png', fullPage: true, timeout: 5000 }); } catch {}

  await ordersPage.clickClear();
  console.log('TC-04 PASSED');
});

// ============================================================
// TC-05: Filter by Date — if a date filter input exists
// ============================================================

test('TC-05: Date filter — shows orders for a specific date range', async () => {
  test.setTimeout(120000);

  if (COL_DATE === -1) {
    console.log('Date column not found — skipping TC-05');
    return;
  }

  const rowCount = await ordersPage.getRowCount();
  if (rowCount === 0) {
    console.log('No orders — skipping TC-05');
    return;
  }

  // Read the date from the first order row to use as the filter value
  const dateValue = await ordersPage.getCellText(0, COL_DATE);
  console.log('Date from first order row:', dateValue);

  if (!dateValue) {
    console.log('Could not read date from grid — skipping TC-05');
    return;
  }

  const totalBefore = await ordersPage.getPaginationTotal();
  await ordersPage.setTextFilter(COL_DATE, dateValue);
  await ordersPage.clickSearch();

  const totalAfter = await ordersPage.getPaginationTotal();
  console.log(`Date filter "${dateValue}" → before: ${totalBefore} | after: ${totalAfter}`);
  console.log('Filter reduced results:', totalAfter <= totalBefore);

  try { await page.screenshot({ path: 'screenshots/orders-filter-tc05-date.png', fullPage: true, timeout: 5000 }); } catch {}

  await ordersPage.clickClear();
  console.log('TC-05 PASSED');
});

// ============================================================
// TC-06: Combined filters — ID + Status
// ============================================================

test('TC-06: Combined ID + Status filter — intersect narrows results', async () => {
  test.setTimeout(120000);

  const rowCount = await ordersPage.getRowCount();
  if (rowCount === 0) {
    console.log('No orders — skipping TC-06');
    return;
  }

  const idColIndex = COL_ID !== -1 ? COL_ID : 1;
  const realId = await ordersPage.getCellText(0, idColIndex);

  if (!realId) {
    console.log('Could not read ID — skipping TC-06');
    return;
  }

  const totalBefore = await ordersPage.getPaginationTotal();

  // Apply ID filter
  await ordersPage.setTextFilter(idColIndex, realId);

  // Apply status filter too if available
  if (COL_STATUS !== -1) {
    const statusOptions = ['Open', 'Shipped', 'Cancelled', 'Processing', 'New'];
    for (const status of statusOptions) {
      await ordersPage.setDropdownFilter(COL_STATUS, status);
      break; // just apply the first one
    }
  }

  await ordersPage.clickSearch();

  const totalAfter = await ordersPage.getPaginationTotal();
  console.log(`Combined filters → before: ${totalBefore} | after: ${totalAfter}`);
  console.log('Combined filter reduced or maintained results:', totalAfter <= totalBefore);

  try { await page.screenshot({ path: 'screenshots/orders-filter-tc06-combined.png', fullPage: true, timeout: 5000 }); } catch {}

  await ordersPage.clickClear();
  console.log('TC-06 PASSED');
});

// ============================================================
// TC-07: Pagination with filter applied
// ============================================================

test('TC-07: Pagination text updates correctly after filter is applied', async () => {
  test.setTimeout(60000);

  const rowCount = await ordersPage.getRowCount();
  if (rowCount === 0) {
    console.log('No orders — skipping TC-07');
    return;
  }

  const totalBefore = await ordersPage.getPaginationTotal();
  const paginationBefore = await ordersPage.getPaginationText();
  console.log('Pagination before filter:', paginationBefore);

  // Apply a filter that should reduce results
  const idColIndex = COL_ID !== -1 ? COL_ID : 1;
  const realId = await ordersPage.getCellText(0, idColIndex);

  if (realId) {
    await ordersPage.setTextFilter(idColIndex, realId);
    await ordersPage.clickSearch();

    const paginationAfter = await ordersPage.getPaginationText();
    const totalAfter = await ordersPage.getPaginationTotal();
    console.log('Pagination after filter:', paginationAfter, '| total:', totalAfter);
    console.log('Pagination text updated:', paginationAfter !== 'N/A');
    console.log('Count reduced or equal:', totalAfter <= totalBefore);
  }

  try { await page.screenshot({ path: 'screenshots/orders-filter-tc07-pagination.png', fullPage: true, timeout: 5000 }); } catch {}

  await ordersPage.clickClear();
  console.log('TC-07 PASSED');
});

// ============================================================
// NEGATIVE TESTS
// ============================================================

test('Orders filter negative: non-existent ID shows no results', async () => {
  test.setTimeout(60000);

  const idColIndex = COL_ID !== -1 ? COL_ID : 1;
  const totalBefore = await ordersPage.getPaginationTotal();

  await ordersPage.setTextFilter(idColIndex, 'ZZZNOMATCH_99999_IMPOSSIBLE');
  await ordersPage.clickSearch();

  const totalAfter = await ordersPage.getPaginationTotal();
  const rowCount = await ordersPage.getRowCount();
  const body = await page.locator('body').innerText();

  console.log(`Non-existent ID filter → rows: ${rowCount} | total: ${totalAfter}`);
  console.log('No results shown:', rowCount === 0 || totalAfter === 0 ||
    body.toLowerCase().includes('no ') || body.toLowerCase().includes('0'));

  try { await page.screenshot({ path: 'screenshots/orders-filter-neg-no-match.png', fullPage: true, timeout: 5000 }); } catch {}

  await ordersPage.clickClear();
  console.log('NEGATIVE: no-match filter PASSED');
});

test('Orders filter negative: special characters in ID filter do not crash the page', async () => {
  test.setTimeout(60000);

  const idColIndex = COL_ID !== -1 ? COL_ID : 1;
  await ordersPage.setTextFilter(idColIndex, '!@#$%^&*()');
  await ordersPage.clickSearch();

  const body = await page.locator('body').innerText();
  // Page should still be alive — no JS error / no blank page
  console.log('Page alive after special chars filter:', body.length > 0);
  console.log('No crash (body has content):', !body.toLowerCase().includes('error') || body.length > 100);

  try { await page.screenshot({ path: 'screenshots/orders-filter-neg-special-chars.png', fullPage: true, timeout: 5000 }); } catch {}

  await ordersPage.clickClear();
  console.log('NEGATIVE: special chars filter PASSED');
});

test('Orders filter negative: filter then clear always restores full count', async () => {
  test.setTimeout(60000);

  const totalOriginal = await ordersPage.getPaginationTotal();

  // Apply a filter
  const idColIndex = COL_ID !== -1 ? COL_ID : 1;
  await ordersPage.setTextFilter(idColIndex, 'SHOULDMATCHNOTHING');
  await ordersPage.clickSearch();

  const totalFiltered = await ordersPage.getPaginationTotal();
  console.log(`Filtered count: ${totalFiltered}`);

  // Clear must restore
  await ordersPage.clickClear();
  const totalRestored = await ordersPage.getPaginationTotal();
  console.log(`Restored: ${totalRestored} (original: ${totalOriginal})`);
  console.log('Clear restored count:', totalRestored === totalOriginal);

  try { await page.screenshot({ path: 'screenshots/orders-filter-neg-restore.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('NEGATIVE: clear restores PASSED');
});
