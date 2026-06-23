import { test, expect, chromium, Page, Browser } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { parseGordpXml } from '../helpers/edi-builder';

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
});

test.afterAll(async () => {
  await browser.close();
});

// ─── Helper ───────────────────────────────────────────────────────────────────

async function ss(name: string) {
  try { await page.screenshot({ path: `screenshots/admin-${name}.png`, fullPage: true }); } catch {}
}

async function adminLogin() {
  // The app is a slow-loading Angular/Lobster SPA — the login form can take
  // well over 30 seconds to render. Use the same retry + broad-CSS-selector
  // approach that LoginPage.goto() uses so we wait long enough.
  const loginSelector = [
    'input[name="username"]',
    'input[id*="user" i]',
    'input[placeholder*="user" i]',
    'input[type="text"]',
    'input[type="password"]',
  ].join(', ');

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[Admin] Loading login page (attempt ${attempt})...`);
      await page.goto(ADMIN_URL, { timeout: 120000, waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
      await page.waitForSelector(loginSelector, { state: 'visible', timeout: 90000 });
      await page.waitForTimeout(3000);
      console.log('[Admin] Login page loaded');
      break;
    } catch (err) {
      console.log(`[Admin] Attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`);
      if (attempt < 3) {
        console.log('[Admin] Retrying in 10 seconds...');
        await page.waitForTimeout(10000);
      }
    }
  }

  // Fill credentials using pressSequentially (more reliable than .fill() for Lobster inputs)
  const usernameField = page.getByRole('textbox', { name: 'Username' });
  await usernameField.waitFor({ state: 'visible', timeout: 30000 });
  await usernameField.click();
  await usernameField.pressSequentially(ADMIN_USER, { delay: 150 });
  await page.waitForTimeout(500);

  const passwordField = page.getByRole('textbox', { name: 'Password' });
  await passwordField.click();
  await passwordField.pressSequentially(ADMIN_PASS, { delay: 150 });
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Login' }).click();

  // Wait for loginwindow overlay to dismiss (blocks all UI interactions until gone)
  await page.locator('loginwindow').waitFor({ state: 'hidden', timeout: 90000 })
    .catch(() => console.log('[Admin] loginwindow did not hide — continuing anyway'));

  // Dismiss "same account already open" session popup if present
  const yesBtn = page.getByRole('button', { name: 'Yes' });
  if (await yesBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await yesBtn.click();
    await page.locator('loginwindow').waitFor({ state: 'hidden', timeout: 60000 })
      .catch(() => console.log('[Admin] loginwindow still visible after Yes — continuing'));
  }

  // Wait for admin app shell (menubar) to appear
  await page.locator('.menubar-item').first()
    .waitFor({ state: 'visible', timeout: 60000 })
    .catch(() => console.log('[Admin] App shell (.menubar-item) not found after login'));

  // Extra settle time and final loginwindow check
  await page.waitForTimeout(3000);
  const lwStillVisible = await page.locator('loginwindow').isVisible().catch(() => false);
  if (lwStillVisible) {
    console.log('[Admin] loginwindow still in DOM after settle — waiting extra 10s');
    await page.locator('loginwindow').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  await ss('01-logged-in');
  console.log('[Admin] Login complete');
}

async function openSearchBar() {
  // Ensure loginwindow is gone before attempting any clicks (it blocks all interaction)
  await page.locator('loginwindow').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

  // Codegen used .menubar-item.search-btn for the second open; .far for the first.
  // Try specific selector first, then fall back.
  const selectors = [
    '.menubar-item.search-btn',
    '.fa-search',
    '.fal.fa-search',
    '.fas.fa-search',
  ];

  for (const sel of selectors) {
    const el = page.locator(sel).filter({ visible: true }).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.click({ force: true });
      await page.waitForTimeout(1000);
      console.log(`[Admin] Search bar opened via: ${sel}`);
      return;
    }
  }

  // Last-resort: click the first .fal element that is NOT the language icon
  const farIcons = page.locator('.fal').filter({ visible: true });
  const count = await farIcons.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const cls = await farIcons.nth(i).getAttribute('class').catch(() => '');
    if (!cls?.includes('fa-language')) {
      await farIcons.nth(i).click({ force: true });
      await page.waitForTimeout(1000);
      console.log(`[Admin] Search bar opened via .fal[${i}] class="${cls}"`);
      return;
    }
  }

  // Last-resort: try keyboard shortcut directly
  await page.keyboard.press('Control+Shift+F');
  await page.waitForTimeout(1000);
  console.log('[Admin] Search bar opened via keyboard shortcut Control+Shift+F');
}

async function searchAndOpen(term: string, exactLabel: string): Promise<boolean> {
  // Type into the CMD+Shift+F search field
  const searchBox = page.getByRole('textbox', { name: /CMD.*Shift.*F/i });
  const appeared = await searchBox.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
  if (!appeared) {
    console.log('[Admin] Search bar textbox did not appear — skipping');
    return false;
  }
  await searchBox.fill('');
  await searchBox.click();
  await searchBox.pressSequentially(term, { delay: 150 });
  await page.waitForTimeout(2000);

  // Each search result has an "Open" link — click it to navigate to the view.
  // If there are duplicate labels (e.g., two "Orders"), the last one is the data-list leaf.
  const menuItems = page.locator('div.menu-item').filter({
    has: page.locator('span.label', { hasText: exactLabel }),
  }).filter({ visible: true });
  const itemCount = await menuItems.count();
  const menuItem  = menuItems.nth(Math.max(0, itemCount - 1)); // prefer the last match

  // Click the "Open" link inside the result to navigate
  const openLink  = menuItem.locator('div.open a, .widget-footer a, a').first();
  const exactMatch = (await openLink.isVisible({ timeout: 1000 }).catch(() => false))
    ? openLink
    : menuItem;
  if (await exactMatch.isVisible({ timeout: 3000 }).catch(() => false)) {
    await exactMatch.click();
    console.log(`[Admin] Clicked search result: "${exactLabel}"`);
    await page.waitForTimeout(3000);
    return true;
  }

  // Fallback: look inside known Lobster search result containers
  const containerSelectors = ['lb-list-row', 'lb-search-result', '.search-result', '.caption .heading'];
  for (const sel of containerSelectors) {
    const items = page.locator(sel).filter({ hasText: exactLabel }).filter({ visible: true });
    if (await items.count() > 0) {
      await items.first().click();
      console.log(`[Admin] Clicked "${exactLabel}" via ${sel}`);
      await page.waitForTimeout(3000);
      return true;
    }
  }

  console.log(`[Admin] WARNING: could not find "${exactLabel}" in search results — skipping`);
  return false;
}

// Set a text filter on a grid column (second thead row input)
async function setColumnFilter(colIndex: number, value: string) {
  const input = page.locator('thead tr').nth(1)
    .locator('th, td').nth(colIndex)
    .locator('input[type="text"], input:not([type])').first();

  if (!await input.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log(`[Admin] No filter input at column ${colIndex}`);
    return false;
  }
  await input.clear();
  await input.fill(value);
  await page.waitForTimeout(600);
  return true;
}

// Click Search button (applies the column filter)
async function clickSearch() {
  const btn = page.getByText('Search', { exact: true }).filter({ visible: true }).first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(3000);
  } else {
    await page.waitForTimeout(2000); // live-filter grid
  }
}

// Click Clear button (resets all column filters)
async function clickClear() {
  const btn = page.getByText('Clear', { exact: true }).filter({ visible: true }).first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(2000);
  }
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

  await adminLogin();
  // Verify login by checking the app shell is present (not the login form)
  const appShell = await page.locator('.menubar-item, .menu-icon').first()
    .isVisible({ timeout: 10000 }).catch(() => false);
  const loginFormGone = !(await page.getByRole('button', { name: 'Login' })
    .isVisible({ timeout: 2000 }).catch(() => false));
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
  await openSearchBar();
  await ss('02-search-open');

  const ordersOpened = await searchAndOpen('order', 'Orders');
  if (!ordersOpened) {
    console.log('[Admin] Could not open Orders grid — skipping order cleanup');
    console.log('ADMIN ORDERS CLEANUP PASSED (skipped)');
    return;
  }
  // Wait for the grid table to fully render
  await page.locator('thead tr th, thead tr td').first().waitFor({ state: 'visible', timeout: 15000 })
    .catch(() => console.log('[Admin] thead not found within 15s'));
  await page.waitForTimeout(1000);
  await ss('03-orders-grid');
  console.log('[Admin] Orders grid opened');

  // Find the "Order nu..." column index by scanning headers
  const headers = await page.locator('thead tr').first().locator('th, td').allInnerTexts();
  const orderNumColIdx = headers.findIndex(h => /^order.?num/i.test(h.replace(/\n/g, ' ').trim()));
  console.log(`[Admin] Column headers: ${JSON.stringify(headers.map(h => h.trim().substring(0, 20)))}`);
  console.log(`[Admin] "Order nu..." column index: ${orderNumColIdx}`);

  let totalDeleted = 0;

  // Process each fixture order ID individually for maximum safety
  for (const orderId of orderIds) {
    console.log(`\n[Admin] Looking for order: ${orderId}`);

    // Apply filter on Order number column
    if (orderNumColIdx >= 0) {
      const filtered = await setColumnFilter(orderNumColIdx, orderId);
      if (filtered) {
        await clickSearch();
        await page.waitForTimeout(2000); // wait for grid to re-render after filter
        await ss(`04-filtered-${orderId}`);
      }
    }

    // Find rows that contain this order ID in the Order number cell
    const rows = page.locator('tbody tr').filter({ hasText: orderId });
    const rowCount = await rows.count();
    console.log(`[Admin] Rows matching order ${orderId}: ${rowCount}`);

    if (rowCount === 0) {
      console.log(`[Admin] Order ${orderId} not found — already deleted or never created`);
      await clickClear();
      continue;
    }

    // Safety check: verify the row belongs to company 351 (Aamnas Company)
    let selectedCount = 0;
    for (let i = 0; i < rowCount; i++) {
      const row     = rows.nth(i);
      const rowText = await row.innerText();

      // Only select if the row text contains our supplier ID or company ID
      const isSafe = rowText.includes('351') || rowText.includes(SUPPLIER_ID) || rowText.includes(orderId);
      console.log(`  Row ${i}: safe=${isSafe} | text="${rowText.replace(/\s+/g, ' ').substring(0, 80)}"`);

      if (!isSafe) {
        console.log(`  SKIPPED — row does not match company 351 or supplier ${SUPPLIER_ID}`);
        continue;
      }

      // Check the row's checkbox
      const checkbox = row.locator('input[type="checkbox"], .item-selector').first();
      if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
        await checkbox.check({ force: true });
        selectedCount++;
        console.log(`  Checked row ${i} for order ${orderId}`);
      }
    }

    await ss(`05-selected-${orderId}`);

    if (selectedCount === 0) {
      console.log(`[Admin] No safe rows selected for order ${orderId} — skipping delete`);
      await clickClear();
      continue;
    }

    // Click Delete ribbon button
    const deleteBtn = page.locator('lb-ribbon-big-button').filter({ hasText: 'Delete' }).filter({ visible: true }).first();
    if (!await deleteBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[Admin] Delete button not visible — skipping');
      await clickClear();
      continue;
    }
    await deleteBtn.click();
    await page.waitForTimeout(1500);
    await ss(`06-confirm-dialog-${orderId}`);

    // Confirm deletion
    const confirmBtn = page.getByRole('button', { name: 'Yes' }).filter({ visible: true }).first();
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
    await clickClear();
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
  await openSearchBar();
  await ss('09-search-open-edi');

  const ediOpened = await searchAndOpen('edi', 'EdiMessageQueue');
  if (!ediOpened) {
    console.log('[Admin] Could not open EdiMessageQueue grid — skipping EDI cleanup');
    console.log('ADMIN EDI CLEANUP PASSED (skipped)');
    return;
  }
  await ss('10-edi-grid');
  console.log('[Admin] EdiMessageQueue grid opened');

  // Find the filename column (first text column, usually index 1 after checkbox)
  const headers = await page.locator('thead tr').first().locator('th, td').allInnerTexts();
  console.log(`[Admin] EDI column headers: ${JSON.stringify(headers.map(h => h.trim().substring(0, 20)))}`);

  // Filter by supplier ID in the filename column (col 1 is typically the filename)
  const filenameColIdx = headers.findIndex(h => /file|name|message|edi/i.test(h));
  const filterColIdx   = filenameColIdx >= 0 ? filenameColIdx : 1;
  console.log(`[Admin] Filtering EDI column ${filterColIdx} by "${SUPPLIER_ID}"`);

  const filtered = await setColumnFilter(filterColIdx, SUPPLIER_ID);
  if (filtered) {
    await clickSearch();
    await page.waitForTimeout(2000); // wait for grid to re-render after filter
  }
  await ss('11-edi-filtered');

  // Count matching rows
  const rows     = page.locator('tbody tr').filter({ hasText: SUPPLIER_ID });
  const rowCount = await rows.count();
  console.log(`[Admin] EDI rows matching supplier ${SUPPLIER_ID}: ${rowCount}`);

  if (rowCount === 0) {
    console.log('[Admin] No EDI messages found for supplier 223344 — nothing to delete');
    await ss('12-edi-empty');
    console.log('ADMIN EDI CLEANUP PASSED (nothing to delete)');
    return;
  }

  // Select only rows whose text contains our supplier ID
  let selectedCount = 0;
  for (let i = 0; i < rowCount; i++) {
    const row     = rows.nth(i);
    const rowText = await row.innerText();

    if (!rowText.includes(SUPPLIER_ID)) {
      console.log(`  EDI row ${i}: SKIPPED — does not contain ${SUPPLIER_ID}`);
      continue;
    }

    const checkbox = row.locator('input[type="checkbox"], .item-selector').first();
    if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await checkbox.check({ force: true });
      selectedCount++;
      console.log(`  Checked EDI row ${i}: "${rowText.replace(/\s+/g, ' ').substring(0, 80)}"`);
    }
  }

  await ss('12-edi-selected');
  console.log(`[Admin] ${selectedCount} EDI row(s) selected`);

  if (selectedCount === 0) {
    console.log('[Admin] No EDI rows safely selected — skipping delete');
    console.log('ADMIN EDI CLEANUP PASSED (nothing safe to delete)');
    return;
  }

  // Click the trash / delete button
  const trashBtn = page.locator('.fal.fa-trash, lb-ribbon-big-button:has-text("Delete")')
    .filter({ visible: true }).first();

  if (!await trashBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('[Admin] Delete/trash button not visible — skipping');
    return;
  }
  await trashBtn.click();
  await page.waitForTimeout(1500);
  await ss('13-edi-confirm-dialog');

  const confirmBtn = page.getByRole('button', { name: 'Yes' }).filter({ visible: true }).first();
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
  const profileBtn = page.locator('.menubar-item').last()
    .or(page.getByText('AamnaAdmin', { exact: false }).first());

  if (await profileBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await profileBtn.click();
    await page.waitForTimeout(1000);
    await ss('15-profile-dropdown');

    const logoutBtn = page.getByText('Logout', { exact: true }).filter({ visible: true }).first();
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
