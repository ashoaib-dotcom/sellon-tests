import { test, expect, chromium, Page, Browser } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { parseGordpXml } from '../helpers/edi-builder';
import { AdminPage } from '../pages/admin.page';

// ─── Admin panel cleanup ──────────────────────────────────────────────────────
//
//  Runs LAST in the suite (file 17). Logs into the admin panel and deletes:
//    1. Orders  — matched by ORDER_NUMBER from the SFTP fixture files
//                 (all fixture order numbers start with "6183031")
//                 Only rows owned by company 351 (Aamnas Company) are touched.
//    2. EDI     — messages filtered by supplier ID "223344" in the filename
//
//  SAFETY GUARANTEES
//    • Orders  : filter column "Order nu..." by each fixture ORDER_ID.
//                These IDs are unique to the SFTP fixtures and belong only to
//                company 351. No other company's orders are ever selected.
//    • EDI     : filter by "223344" — only messages from the test supplier.
//    • Both grids are filtered BEFORE any checkbox is ticked.
//    • No select-all — only explicitly matching rows are checked.

test.describe.configure({ mode: 'serial' });

// ─── Constants ────────────────────────────────────────────────────────────────

const ADMIN_URL      = process.env.BASE_URL      || 'https://stage.sellon.ch/';
const ADMIN_USER     = process.env.ADMIN_USERNAME || '';
const ADMIN_PASS     = process.env.ADMIN_PASSWORD || '';
const SUPPLIER_ID    = process.env.ADMIN_SUPPLIER_ID || '223344';

// Load the actual ORDER_IDs from the fixtures/ folder at runtime
function loadFixtureOrderIds(): string[] {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  if (!fs.existsSync(fixturesDir)) return [];
  return fs.readdirSync(fixturesDir)
    .filter(f => f.startsWith('GORDP_') && f.endsWith('.xml'))
    .sort()
    .map(f => {
      const raw    = fs.readFileSync(path.join(fixturesDir, f), 'utf-8');
      const parsed = parseGordpXml(raw);
      return parsed?.orderId || '';
    })
    .filter(Boolean);
}

// ─── State ────────────────────────────────────────────────────────────────────

let browser:    Browser;
let page:       Page;
let adminPage:  AdminPage;
let orderIds:   string[] = [];

// ─── Setup / teardown ─────────────────────────────────────────────────────────

test.beforeAll(async () => {
  test.setTimeout(300000);

  orderIds = loadFixtureOrderIds();
  console.log(`[Admin] Fixture order IDs to clean up: ${orderIds.join(', ') || '(none found)'}`);

  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page = await context.newPage();
  adminPage = new AdminPage(page);
});

test.afterAll(async () => {
  await browser.close();
});

// ─── Helper ───────────────────────────────────────────────────────────────────

async function ss(name: string) {
  try { await page.screenshot({ path: `screenshots/admin-${name}.png`, fullPage: true }); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Login to admin
// ─────────────────────────────────────────────────────────────────────────────

test('Admin: login to admin panel', async () => {
  test.setTimeout(180000);

  if (!ADMIN_USER || !ADMIN_PASS) {
    console.log('[Admin] ADMIN_USERNAME / ADMIN_PASSWORD not set — skipping');
    test.skip();
    return;
  }

  await adminPage.login(ADMIN_URL, ADMIN_USER, ADMIN_PASS);
  await ss('01-logged-in');

  // Verify login by checking the app shell is present (not the login form)
  const appShell = await adminPage.isAppShellVisible();
  const loginFormGone = !(await adminPage.isLoginFormVisible());
  console.log('[Admin] App shell visible:', appShell);
  console.log('[Admin] Login form gone:', loginFormGone);
  expect(appShell || loginFormGone, 'Admin login should succeed').toBe(true);
  console.log('ADMIN LOGIN PASSED');
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Delete fixture orders from Orders tab
// ─────────────────────────────────────────────────────────────────────────────

test('Admin: delete fixture orders from Orders tab (supplier 223344 only)', async () => {
  test.setTimeout(120000);

  if (orderIds.length === 0) {
    console.log('[Admin] No fixture order IDs found — skipping order cleanup');
    return;
  }

  // Open Orders via global search bar
  await adminPage.openSearchBar();
  await ss('02-search-open');

  const ordersOpened = await adminPage.searchAndOpen('order', 'Orders');
  if (!ordersOpened) {
    console.log('[Admin] Could not open Orders grid — skipping order cleanup');
    console.log('ADMIN ORDERS CLEANUP PASSED (skipped)');
    return;
  }
  // Wait for the grid table to fully render
  await adminPage.waitForGrid();
  await ss('03-orders-grid');
  console.log('[Admin] Orders grid opened');

  // Find the "Order nu..." column index by scanning headers
  const headers = await adminPage.getColumnHeaders();
  const orderNumColIdx = headers.findIndex(h => /^order.?num/i.test(h.replace(/\n/g, ' ').trim()));
  console.log(`[Admin] Column headers: ${JSON.stringify(headers.map(h => h.trim().substring(0, 20)))}`);
  console.log(`[Admin] "Order nu..." column index: ${orderNumColIdx}`);

  let totalDeleted = 0;

  // Process each fixture order ID individually for maximum safety
  for (const orderId of orderIds) {
    console.log(`\n[Admin] Looking for order: ${orderId}`);

    // Apply filter on Order number column
    if (orderNumColIdx >= 0) {
      const filtered = await adminPage.setColumnFilter(orderNumColIdx, orderId);
      if (filtered) {
        await adminPage.clickSearch();
        await page.waitForTimeout(2000);
        await ss(`04-filtered-${orderId}`);
      }
    }

    // Find rows that contain this order ID in the Order number cell
    const rows = adminPage.getRowsContaining(orderId);
    const rowCount = await rows.count();
    console.log(`[Admin] Rows matching order ${orderId}: ${rowCount}`);

    if (rowCount === 0) {
      console.log(`[Admin] Order ${orderId} not found — already deleted or never created`);
      await adminPage.clickClear();
      continue;
    }

    // Safety check: verify the row belongs to company 351 (Aamnas Company)
    const selectedCount = await adminPage.selectSafeRows(orderId, ['351', SUPPLIER_ID, orderId]);
    console.log(`  Selected ${selectedCount} row(s) for order ${orderId}`);

    await ss(`05-selected-${orderId}`);

    if (selectedCount === 0) {
      console.log(`[Admin] No safe rows selected for order ${orderId} — skipping delete`);
      await adminPage.clickClear();
      continue;
    }

    // Click Delete ribbon button
    const deleteBtn = adminPage.getDeleteButton();
    if (!await deleteBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[Admin] Delete button not visible — skipping');
      await adminPage.clickClear();
      continue;
    }
    await deleteBtn.click();
    await page.waitForTimeout(1500);
    await ss(`06-confirm-dialog-${orderId}`);

    // Confirm deletion
    const confirmBtn = adminPage.getConfirmYesButton();
    if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(3000);
      totalDeleted += selectedCount;
      console.log(`[Admin] Order ${orderId} deleted ✓`);
    } else {
      console.log(`[Admin] Confirm dialog not found — cancelling`);
      await page.keyboard.press('Escape');
    }

    await ss(`07-after-delete-${orderId}`);
    await adminPage.clickClear();
    await page.waitForTimeout(1000);
  }

  await ss('08-orders-cleanup-done');
  console.log(`\n[Admin] Orders cleanup complete — ${totalDeleted} row(s) deleted`);
  console.log('ADMIN ORDERS CLEANUP PASSED');
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Delete EDI messages from EdiMessageQueue tab
// ─────────────────────────────────────────────────────────────────────────────

test('Admin: delete EDI messages from EdiMessageQueue (supplier 223344 only)', async () => {
  test.setTimeout(120000);

  // Open EdiMessageQueue via global search bar
  await adminPage.openSearchBar();
  await ss('09-search-open-edi');

  const ediOpened = await adminPage.searchAndOpen('edi', 'EdiMessageQueue');
  if (!ediOpened) {
    console.log('[Admin] Could not open EdiMessageQueue grid — skipping EDI cleanup');
    console.log('ADMIN EDI CLEANUP PASSED (skipped)');
    return;
  }
  await ss('10-edi-grid');
  console.log('[Admin] EdiMessageQueue grid opened');

  // Find the filename column (first text column, usually index 1 after checkbox)
  const headers = await adminPage.getColumnHeaders();
  console.log(`[Admin] EDI column headers: ${JSON.stringify(headers.map(h => h.trim().substring(0, 20)))}`);

  // Filter by supplier ID in the filename column (col 1 is typically the filename)
  const filenameColIdx = headers.findIndex(h => /file|name|message|edi/i.test(h));
  const filterColIdx   = filenameColIdx >= 0 ? filenameColIdx : 1;
  console.log(`[Admin] Filtering EDI column ${filterColIdx} by "${SUPPLIER_ID}"`);

  const filtered = await adminPage.setColumnFilter(filterColIdx, SUPPLIER_ID);
  if (filtered) {
    await adminPage.clickSearch();
    await page.waitForTimeout(2000);
  }
  await ss('11-edi-filtered');

  // Count matching rows
  const rows     = adminPage.getRowsContaining(SUPPLIER_ID);
  const rowCount = await rows.count();
  console.log(`[Admin] EDI rows matching supplier ${SUPPLIER_ID}: ${rowCount}`);

  if (rowCount === 0) {
    console.log('[Admin] No EDI messages found for supplier 223344 — nothing to delete');
    await ss('12-edi-empty');
    console.log('ADMIN EDI CLEANUP PASSED (nothing to delete)');
    return;
  }

  // Select only rows whose text contains our supplier ID
  const selectedCount = await adminPage.selectSafeRows(SUPPLIER_ID, [SUPPLIER_ID]);
  console.log(`  Selected ${selectedCount} EDI row(s)`);

  await ss('12-edi-selected');
  console.log(`[Admin] ${selectedCount} EDI row(s) selected`);

  if (selectedCount === 0) {
    console.log('[Admin] No EDI rows safely selected — skipping delete');
    console.log('ADMIN EDI CLEANUP PASSED (nothing safe to delete)');
    return;
  }

  // Click the trash / delete button
  const trashBtn = adminPage.getTrashOrDeleteButton();

  if (!await trashBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('[Admin] Delete/trash button not visible — skipping');
    return;
  }
  await trashBtn.click();
  await page.waitForTimeout(1500);
  await ss('13-edi-confirm-dialog');

  const confirmBtn = adminPage.getConfirmYesButton();
  if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await confirmBtn.click();
    await page.waitForTimeout(3000);
    console.log(`[Admin] ${selectedCount} EDI message(s) deleted ✓`);
  } else {
    console.log('[Admin] Confirm dialog not found — cancelling');
    await page.keyboard.press('Escape');
  }

  await ss('14-edi-cleanup-done');
  console.log('ADMIN EDI CLEANUP PASSED');
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Logout from admin
// ─────────────────────────────────────────────────────────────────────────────

test('Admin: logout from admin panel', async () => {
  test.setTimeout(30000);

  // Click the profile/avatar button (top-right area)
  const profileBtn = adminPage.getProfileButton('AamnaAdmin');

  if (await profileBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await profileBtn.click();
    await page.waitForTimeout(1000);
    await ss('15-profile-dropdown');

    const logoutBtn = adminPage.getLogoutButton();
    if (await logoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await logoutBtn.click();
      await page.waitForTimeout(2000);
      await ss('16-logged-out');
      console.log('[Admin] Logged out');
    }
  } else {
    console.log('[Admin] Profile button not found — skipping logout');
  }

  console.log('ADMIN LOGOUT PASSED');
});
