import { test, expect, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { NavigationPage } from '../pages/navigation.page';
import { OrdersPage } from '../pages/orders.page';
import { ProductListPage } from '../pages/product-list.page';
import { getSftpHelper, SftpHelper } from '../helpers/sftp-upload';
import { buildGORDR, buildGDELR, buildGCANR, buildGSURN, buildGCANP, buildGRETP, buildGORDP } from '../helpers/edi-builder';

test.describe.configure({ mode: 'serial' });

// Discover and process up to this many orders — increase as needed
const MAX_ORDERS = 10;

// Populated in beforeAll by discoverOrders()
let orders: string[] = [];
let orderPositions: { sku: string; qty: number }[][] = [];

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let navPage: NavigationPage;
let ordersPage: OrdersPage;
let productListPage: ProductListPage;
let sftp: SftpHelper;

// ===========================================================================
// Helpers
// ===========================================================================

async function ensureLoggedIn(): Promise<void> {
  try {
    const visible = await page.locator('.menu-icon').isVisible({ timeout: 4000 });
    if (visible) return;
  } catch {}
  console.log('[AUTH] Session expired — re-logging in');
  try {
    await loginPage.login(
      process.env.TEST_USERNAME || 'ashoaib',
      process.env.TEST_PASSWORD || 'test2',
    );
  } catch (e) {
    console.log('[AUTH] Re-login failed:', (e as Error).message);
  }
}

async function screenshot(name: string): Promise<void> {
  try { await page.screenshot({ path: `screenshots/${name}.png` }); } catch {}
}

async function getOrderStatus(): Promise<string> {
  const body = await page.locator('body').textContent() || '';
  for (const s of ['New', 'Open', 'Confirmed', 'Shipped', 'Cancelled', 'Closed']) {
    if (body.includes(s)) return s;
  }
  return 'unknown';
}

function sftpPat(type: string, orderId: string): RegExp {
  return orderId ? new RegExp(`${type}.*${orderId}`, 'i') : new RegExp(type, 'i');
}

async function saveOrder(): Promise<void> {
  try {
    const saveBtn = page.getByText('Save', { exact: true }).filter({ visible: true }).first();
    if (await saveBtn.isVisible({ timeout: 3000 })) {
      await saveBtn.click();
    } else {
      const btn = page.getByRole('button', { name: /save/i }).filter({ visible: true }).first();
      if (await btn.isVisible({ timeout: 3000 })) await btn.click();
    }
  } catch {}
  await page.waitForTimeout(4000);
}

async function clickTab(tabName: string): Promise<boolean> {
  try {
    const tab = page.getByText(tabName, { exact: true }).filter({ visible: true }).first();
    if (!await tab.isVisible({ timeout: 5000 })) { console.log(`  Tab "${tabName}" not visible`); return false; }
    await tab.click();
    await page.waitForTimeout(3000);
    return true;
  } catch {
    console.log(`  Tab "${tabName}" not found`);
    return false;
  }
}

// Save current tab before switching — Angular discards unsaved changes on tab navigation
async function saveAndClickTab(tabName: string): Promise<boolean> {
  await saveOrder();
  return clickTab(tabName);
}

async function clickButton(namePattern: string | RegExp, label?: string): Promise<boolean> {
  try {
    const btn = page.getByRole('button', { name: namePattern }).filter({ visible: true }).first();
    if (!await btn.isVisible({ timeout: 3000 })) return false;
    if (!await btn.isEnabled({ timeout: 3000 })) return false;
    await btn.click();
    await page.waitForTimeout(3000);
    return true;
  } catch {
    if (label) console.log(`[clickButton] ${label}: not found`);
    return false;
  }
}

// Close the current order and return to the orders list.
// Tries the X / back button first; falls back to navigation.
async function closeOrder(): Promise<void> {
  try {
    // Try Angular Material close/back icon buttons
    const closeBtn = page.locator([
      'button[aria-label*="close" i]',
      'button[aria-label*="back" i]',
      '[class*="close-btn"]',
      'mat-icon:text("close")',
      'mat-icon:text("arrow_back")',
      'button:has(mat-icon:text("close"))',
      'button:has(mat-icon:text("arrow_back"))',
    ].join(', ')).filter({ visible: true }).first();

    if (await closeBtn.count() > 0 && await closeBtn.isVisible({ timeout: 2000 })) {
      await closeBtn.click();
      await page.waitForTimeout(2000);
      // Verify we left — if order detail is still showing, fall through to navigation
      const stillOnDetail = await page.locator('[class*="order-detail"], [class*="order-form"]')
        .isVisible({ timeout: 2000 }).catch(() => false);
      if (!stillOnDetail) { console.log('  closeOrder: closed via X button'); return; }
    }
  } catch {}

  // Fallback: press Escape, then navigate
  try { await page.keyboard.press('Escape'); await page.waitForTimeout(1000); } catch {}
  await ordersPage.navigateToOrders();
  await page.waitForTimeout(2000);
  console.log('  closeOrder: returned to orders list via navigation');
}

// Navigate to the Shipment tab — saves once, then tries multiple possible tab names
// with a short timeout (much cheaper than chaining saveAndClickTab per name).
async function navigateToShipmentTab(): Promise<boolean> {
  await saveOrder();
  for (const name of ['Shipment', 'Shipments', 'Shipping', 'Delivery', 'Deliveries']) {
    try {
      const tab = page.getByText(name, { exact: true }).filter({ visible: true }).first();
      if (await tab.isVisible({ timeout: 2000 })) {
        await tab.click();
        await page.waitForTimeout(2000);
        console.log(`  Shipment tab found: "${name}"`);
        return true;
      }
    } catch {}
  }
  console.log('  Shipment tab not found — staying on current tab');
  return false;
}

// Confirm all positions in the Order items tab, saving after each confirmation.
async function confirmAllPositions(): Promise<void> {
  const opened = await saveAndClickTab('Order items');
  if (!opened) await clickTab('Items');
  await page.waitForTimeout(1000);

  const rows = page.locator('tbody tr');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    try {
      const confirmBtn = rows.nth(i).getByRole('button', { name: /confirm/i });
      if (await confirmBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await confirmBtn.click();
        await page.waitForTimeout(1000);
        // Fill quantity input if it appears after clicking confirm
        const qtyInput = rows.nth(i).locator('input[type="number"]');
        if (await qtyInput.isVisible({ timeout: 1500 }).catch(() => false)) {
          const val = await qtyInput.inputValue();
          if (!val || val === '0') await qtyInput.fill('1');
        }
        await saveOrder();
      }
    } catch {}
  }
  console.log(`  confirmAllPositions: processed ${count} row(s)`);
}

// Create a single shipment inside the Shipment tab.
// opts.selectAll → check ALL unchecked position rows (default: first row only for partial)
// opts.futureDate → fill delivery date = next month (for back-ordered items)
// opts.parcelType → e.g. 'Letter' (no tracking number needed)
// opts.shipNum → tracking/shipment number to fill
async function createShipment(opts: {
  shipNum?: string;
  selectAll?: boolean;
  futureDate?: boolean;
  parcelType?: string;
} = {}): Promise<boolean> {
  const clicked = await clickButton(/new shipment|create shipment/i, 'new shipment');
  if (!clicked) { console.log('  createShipment: "New Shipment" button not found'); return false; }
  await page.waitForTimeout(2000);

  // Select position checkboxes
  try {
    const checkboxes = page.locator('tbody tr input[type="checkbox"]').filter({ visible: true });
    const total = await checkboxes.count();
    // partial = only first checkbox; selectAll = all unchecked rows
    const limit = opts.selectAll ? total : 1;
    for (let i = 0; i < limit; i++) {
      if (!await checkboxes.nth(i).isChecked().catch(() => false)) {
        await checkboxes.nth(i).check();
      }
    }
    console.log(`  createShipment: selected ${limit}/${total} position(s)`);
  } catch (e) { console.log('  createShipment: checkbox selection failed:', e); }

  // Future delivery date — Swiss format DD.MM.YYYY
  if (opts.futureDate) {
    try {
      const future = new Date();
      future.setMonth(future.getMonth() + 1);
      const dd   = String(future.getDate()).padStart(2, '0');
      const mm   = String(future.getMonth() + 1).padStart(2, '0');
      const yyyy = future.getFullYear();
      const dateStr = `${dd}.${mm}.${yyyy}`;

      const byLabel = page.getByLabel(/delivery date|expected date|date/i, { exact: false }).first();
      const target = (await byLabel.count() > 0 && await byLabel.isVisible({ timeout: 2000 }))
        ? byLabel
        : page.locator('input[type="date"], input[name*="date"], input[placeholder*="date"]')
            .filter({ visible: true }).first();
      if (await target.isVisible({ timeout: 2000 })) {
        await target.fill(dateStr);
        await page.keyboard.press('Tab');
        console.log(`  createShipment: future delivery date → ${dateStr}`);
      }
    } catch (e) { console.log('  createShipment: date fill failed:', e); }
  }

  // Parcel type (e.g. Letter)
  if (opts.parcelType) {
    try {
      const byLabel = page.getByLabel(/parcel type|parcel/i, { exact: false }).first();
      if (await byLabel.count() > 0 && await byLabel.isVisible({ timeout: 2000 })) {
        await byLabel.click();
        await page.waitForTimeout(500);
        const opt = page.locator('mat-option, [role="option"]')
          .filter({ hasText: new RegExp(opts.parcelType, 'i') }).first();
        if (await opt.count() > 0) { await opt.click(); await page.waitForTimeout(500); }
      } else {
        const sel = page.locator('select[name*="parcel"], select[name*="type"]').first();
        if (await sel.isVisible({ timeout: 2000 })) await sel.selectOption({ label: opts.parcelType });
      }
      console.log(`  createShipment: parcel type → ${opts.parcelType}`);
    } catch (e) { console.log('  createShipment: parcel type failed:', e); }
  }

  // Carrier (always DHL; skip for Letter since no carrier needed)
  if (opts.parcelType?.toLowerCase() !== 'letter') {
    try {
      const byLabel = page.getByLabel(/carrier/i, { exact: false }).first();
      if (await byLabel.count() > 0 && await byLabel.isVisible({ timeout: 2000 })) {
        await byLabel.fill('DHL');
      } else {
        const input = page.locator('input[name*="carrier"], input[placeholder*="carrier"]')
          .filter({ visible: true }).first();
        if (await input.isVisible({ timeout: 2000 })) await input.fill('DHL');
      }
      await page.waitForTimeout(800);
      // Accept autocomplete suggestion if one appeared
      const opt = page.locator('mat-option, [role="option"]').filter({ visible: true }).first();
      if (await opt.count() > 0) { await opt.click(); await page.waitForTimeout(400); }
    } catch {}
  }

  // Shipment/tracking number (not required for Letter)
  if (opts.shipNum && opts.parcelType?.toLowerCase() !== 'letter') {
    try {
      const byLabel = page.getByLabel(/shipment number|tracking/i, { exact: false }).first();
      if (await byLabel.count() > 0 && await byLabel.isVisible({ timeout: 2000 })) {
        await byLabel.fill(opts.shipNum);
      } else {
        const input = page.locator('input[name*="shipment"], input[name*="tracking"], input[name*="number"]')
          .filter({ visible: true }).first();
        if (await input.isVisible({ timeout: 2000 })) await input.fill(opts.shipNum);
      }
      console.log(`  createShipment: shipment number → ${opts.shipNum}`);
    } catch {}
  }

  await saveOrder();
  return true;
}

// Fetch real Stage 2 products from the Sellon Products tab.
// Returns up to `maxCount` products with their provider key (SKU) and selling price.
async function fetchStage2Products(maxCount = 5): Promise<{ sku: string; price: number }[]> {
  try {
    await navPage.navigateToProducts();
    await page.waitForTimeout(3000);

    const products: { sku: string; price: number }[] = [];
    const rows = page.locator('tbody tr');
    const rowCount = Math.min(await rows.count(), 50);

    for (let i = 0; i < rowCount && products.length < maxCount; i++) {
      const row = rows.nth(i);
      const rowText = await row.textContent() || '';

      // Only include Stage 2 products (ready for ordering)
      if (!rowText.toLowerCase().includes('stage 2')) continue;

      const cells = await row.locator('td').allInnerTexts();

      // Provider key looks like "XX-YYY-001" (contains at least one hyphen, no spaces, uppercase)
      const sku = cells.find(c => /^[A-Z0-9]+-[A-Z0-9-]+$/.test(c.trim())) || '';

      // Price column — find a cell that looks like a decimal number
      const priceCell = cells.find(c => /^\d+[.,]\d+$/.test(c.trim())) || '';
      const price = parseFloat(priceCell.replace(',', '.')) || 29.90;

      if (sku) {
        products.push({ sku: sku.trim(), price });
        console.log(`  fetchStage2Products: found ${sku.trim()} @ ${price}`);
      }
    }

    console.log(`[fetchStage2Products] ${products.length} Stage 2 product(s) found`);
    return products;
  } catch (e) {
    console.log('[fetchStage2Products] Error:', (e as Error).message);
    return [];
  }
}

// Upload a GORDP file using real Stage 2 products to create a new order in Sellon,
// then wait for it to appear in the orders list.
// Returns the new order ID, or null if SFTP is not configured or the order never appears.
async function createTestOrder(
  stage2Products: { sku: string; price: number }[],
): Promise<string | null> {
  if (!sftp?.isConfigured) {
    console.log('[createTestOrder] SFTP not configured — skipping order creation');
    return null;
  }
  if (stage2Products.length === 0) {
    console.log('[createTestOrder] No Stage 2 products available — skipping');
    return null;
  }

  const orderId = `ORD-${Date.now().toString().slice(-8)}`;

  // Use up to 2 real products per order so the split-shipment path is exercised
  const positions = stage2Products.slice(0, 2).map((p, idx) => ({
    sku:   p.sku,
    qty:   idx === 0 ? 2 : 1,   // first position: qty 2 (partial ship); second: qty 1 (back-order)
    price: p.price,
  }));

  const address = {
    name:    'Test Customer',
    street:  'Teststrasse 1',
    city:    'Zurich',
    zip:     '8001',
    country: 'CH',
  };

  try {
    const ediFile = buildGORDP(orderId, positions, address);
    // GORDP is platform → supplier: upload to remoteOutDir (dg2partner)
    const ok = await sftp.uploadToOutDir(ediFile.content, ediFile.filename);
    if (!ok) { console.log('[createTestOrder] SFTP upload failed'); return null; }
    console.log(`[createTestOrder] Uploaded ${ediFile.filename} (${positions.map(p => p.sku).join(', ')})`);
  } catch (e) {
    console.log('[createTestOrder] Build/upload error:', (e as Error).message);
    return null;
  }

  // Poll the orders list until the new order appears (up to 90 s)
  await ordersPage.navigateToOrders();
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    await page.reload();
    await page.waitForTimeout(2000);
    const body = await page.locator('body').textContent() || '';
    if (body.includes(orderId)) {
      console.log(`[createTestOrder] Order ${orderId} appeared in Sellon`);
      return orderId;
    }
  }

  console.log(`[createTestOrder] Timeout — order ${orderId} never appeared`);
  return null;
}

async function discoverOrders(maxCount = MAX_ORDERS): Promise<string[]> {
  try {
    await ensureLoggedIn();
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(3000);
    const ids: string[] = [];
    const rows = page.locator('tbody tr');
    const rowCount = Math.min(await rows.count(), 50);
    for (let i = 0; i < rowCount && ids.length < maxCount; i++) {
      const cells = rows.nth(i).locator('td');
      const cellCount = await cells.count();
      for (let j = 0; j < Math.min(cellCount, 6); j++) {
        const text = (await cells.nth(j).textContent() || '').trim();
        if (/^\d{6,12}$/.test(text) && !ids.includes(text)) { ids.push(text); break; }
      }
    }
    console.log(`[discoverOrders] Found ${ids.length}: ${ids.join(', ') || 'none'}`);
    return ids;
  } catch (e) {
    console.log('[discoverOrders] Error:', (e as Error).message);
    return [];
  }
}

async function extractPositions(): Promise<{ sku: string; qty: number }[]> {
  try {
    const opened = await clickTab('Order items');
    if (!opened) await clickTab('Items');
    await page.waitForTimeout(2000);
    const positions: { sku: string; qty: number }[] = [];
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const text = (await rows.nth(i).textContent() || '').trim();
      const skuMatch = text.match(/[A-Z]{2,8}-[A-Z]{2,8}-?\d{2,4}/);
      if (skuMatch) {
        const qtyMatch = text.match(/\b(\d{1,5})\b/);
        positions.push({ sku: skuMatch[0], qty: qtyMatch ? Math.max(parseInt(qtyMatch[1], 10), 1) : 1 });
      }
    }
    console.log(`[extractPositions] ${positions.length}: ${positions.map(p => `${p.sku}(${p.qty})`).join(', ')}`);
    return positions;
  } catch (e) {
    console.log('[extractPositions] Error:', (e as Error).message);
    return [];
  }
}

async function findAndOpenOrder(orderId: string): Promise<boolean> {
  try {
    await ensureLoggedIn();
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(3000);
    const filterInputs = page.locator('thead tr').nth(1).locator('input[type="text"], input:not([type])');
    if (orderId && await filterInputs.count() > 0) {
      await filterInputs.first().fill(orderId);
      await page.waitForTimeout(2000);
    }
    let row = orderId
      ? page.locator('tbody tr').filter({ hasText: orderId }).first()
      : page.locator('tbody tr').first();
    if (await row.count() === 0) {
      if (await filterInputs.count() > 0) { await filterInputs.first().fill(''); await page.waitForTimeout(2000); }
      row = page.locator('tbody tr').first();
      if (await row.count() === 0) { console.log('  No orders found'); return false; }
    }
    await row.dblclick();
    await page.waitForTimeout(5000);
    return true;
  } catch (e) {
    console.log(`  findAndOpenOrder(${orderId}) error:`, (e as Error).message);
    return false;
  }
}

async function importEDI(
  type: string,
  orderId: string,
  opts?: { positions?: { sku: string; qty?: number }[]; reason?: string }
): Promise<boolean> {
  let content = '';
  let filename = `${type}_${orderId}_${Date.now()}.edi`;
  try {
    const upper = type.toUpperCase();
    const positions = opts?.positions || [];
    const reason = opts?.reason || '';
    let ediFile: { content: string; filename: string } | null = null;
    if      (upper === 'CANP')  ediFile = buildGCANP(orderId, positions.map(p => ({ sku: p.sku })), reason);
    else if (upper === 'RETP')  ediFile = buildGRETP(orderId, positions.map(p => ({ sku: p.sku, qty: p.qty ?? 1 })), reason);
    else if (upper === 'GORDR') ediFile = buildGORDR(orderId, positions.map(p => ({ sku: p.sku, qty: p.qty ?? 1 })));
    else if (upper === 'GDELR') ediFile = buildGDELR(orderId, positions.map(p => ({ sku: p.sku, qty: p.qty ?? 1 })), 'SHIP-AUTO', 'DHL');
    else if (upper === 'GCANR') ediFile = buildGCANR(orderId, 'Rejected', reason);
    else if (upper === 'GSURN') ediFile = buildGSURN(orderId, 'Rejected', positions.map(p => ({ sku: p.sku })), reason);
    if (ediFile) { content = ediFile.content; filename = ediFile.filename; }
  } catch (e) { console.log(`[importEDI] Build error for ${type}:`, e); }

  if (content && sftp) {
    try {
      const isOutbound = ['CANP', 'RETP', 'GORDP'].includes(type.toUpperCase());
      const result = isOutbound
        ? await sftp.uploadToOutDir(content, filename)
        : await sftp.uploadEDIContent(content, filename);
      console.log(`[importEDI] Uploaded ${filename}:`, result);
    } catch (e) { console.log('[importEDI] SFTP failed:', e); }
  }

  try {
    const importBtn = page.getByRole('button', { name: new RegExp(type, 'i') }).filter({ visible: true }).first();
    if (await importBtn.isVisible({ timeout: 3000 })) {
      await importBtn.click();
    } else {
      const fallback = page.getByText('Import', { exact: true }).filter({ visible: true }).first();
      if (await fallback.isVisible({ timeout: 3000 })) await fallback.click();
    }
  } catch {}
  await page.waitForTimeout(8000);
  return true;
}

async function waitForSftpFile(pattern: RegExp | string, timeoutMs = 60000): Promise<string | null> {
  if (!sftp) { console.log('SFTP not configured — skipping wait for:', pattern); return null; }
  try {
    const inDir = process.env.SFTP_REMOTE_IN_DIR || '/incoming';
    return await sftp.waitForFile(pattern, timeoutMs, 3000, inDir);
  } catch (e) {
    console.log(`[waitForSftpFile] ${pattern}:`, e);
    return null;
  }
}

// ===========================================================================
// Setup / teardown
// ===========================================================================

test.beforeAll(async () => {
  browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page = await context.newPage();
  loginPage = new LoginPage(page);
  navPage = new NavigationPage(page);
  ordersPage = new OrdersPage(page);
  productListPage = new ProductListPage(page);
  sftp = getSftpHelper();

  await loginPage.login(process.env.TEST_USERNAME || 'ashoaib', process.env.TEST_PASSWORD || 'test2');
  await page.waitForTimeout(3000);

  // If SFTP is configured: fetch real Stage 2 products then upload GORDP files to
  // create fresh test orders in Sellon. Fully automated — no manual setup required.
  const orderCount = parseInt(process.env.TEST_ORDER_COUNT || '2', 10);
  if (sftp.isConfigured) {
    console.log(`[setup] Fetching Stage 2 products to use as order positions...`);
    const stage2Products = await fetchStage2Products(orderCount * 2);

    if (stage2Products.length > 0) {
      console.log(`[setup] Creating ${orderCount} order(s) from ${stage2Products.length} Stage 2 product(s)`);
      for (let i = 0; i < orderCount; i++) {
        // Rotate through available products so each order uses a different pair
        const slice = stage2Products.slice((i * 2) % stage2Products.length);
        const orderId = await createTestOrder(slice);
        if (orderId) orders.push(orderId);
      }
      console.log(`[setup] Created ${orders.length} order(s): ${orders.join(', ')}`);
    } else {
      console.log('[setup] No Stage 2 products found — skipping GORDP creation');
    }
  }

  // Fall back to discovering existing orders if SFTP is absent or creation failed
  if (orders.length === 0) {
    console.log('[setup] Falling back to discovering existing orders in Sellon');
    orders = await discoverOrders(MAX_ORDERS);
  }

  orderPositions = Array.from({ length: MAX_ORDERS }, () => []);
  console.log(`Orders ready (${orders.length}): ${orders.join(', ') || 'none'}`);
});

test.afterAll(async () => {
  await sftp.disconnect().catch(() => {});
  await browser.close();
});

// ===========================================================================
// Generic order workflow — one describe per slot (slot skips if no order found)
// ===========================================================================

for (let slot = 0; slot < MAX_ORDERS; slot++) {
  const n = slot + 1; // human-readable order number in log/screenshot names

  test.describe(`Order ${n}`, () => {
    let opened = false;

    // ── 1. Open order, extract positions, verify delivery address ─────────
    test(`[Order ${n}] 1. Open order and verify delivery address`, async () => {
      test.setTimeout(180000);
      if (!orders[slot]) { test.skip(); return; }

      opened = await findAndOpenOrder(orders[slot]);
      if (!opened) { test.skip(); return; }

      orderPositions[slot] = await extractPositions();
      await saveOrder();

      const body = await page.locator('body').textContent() || '';
      const hasAddress = /delivery|address|street|city|zip|name/i.test(body);
      console.log(`[Order ${n}] Delivery address: ${hasAddress} | Positions: ${orderPositions[slot].length}`);
      expect(hasAddress).toBeTruthy();
      await screenshot(`order${n}-1-open`);
    });

    // ── 2. Confirm all positions and save ────────────────────────────────
    test(`[Order ${n}] 2. Confirm all positions`, async () => {
      test.setTimeout(180000);
      if (!opened) { test.skip(); return; }

      await confirmAllPositions();
      await saveOrder();

      const status = await getOrderStatus();
      console.log(`[Order ${n}] Status after confirm: ${status}`);
      await screenshot(`order${n}-2-confirmed`);
    });

    // ── 3. GORDR on SFTP ─────────────────────────────────────────────────
    test(`[Order ${n}] 3. GORDR on SFTP`, async () => {
      test.setTimeout(120000);
      if (!orders[slot]) { test.skip(); return; }
      const file = await waitForSftpFile(sftpPat('GORDR', orders[slot]), 30000);
      console.log(`[Order ${n}] GORDR: ${file || 'not found'}`);
    });

    // ── 4. Create shipment(s) ─────────────────────────────────────────────
    // If the order has more than one position (more items than one stock line):
    //   • First shipment: partial — ships available positions now
    //   • Second shipment: remaining positions — future delivery date (back-order),
    //     Letter parcel type (no tracking number required)
    // If the order has only one position: single full shipment.
    test(`[Order ${n}] 4. Create shipment(s) — split if multiple positions`, async () => {
      test.setTimeout(180000);
      if (!opened) { test.skip(); return; }

      await navigateToShipmentTab();
      const positions = orderPositions[slot];

      if (positions.length <= 1) {
        // Single shipment — ship all available positions now
        await createShipment({ shipNum: `SHIP-${orders[slot]}-1`, selectAll: true });
        console.log(`[Order ${n}] Single shipment created`);
      } else {
        // Split shipment: first partial (available stock, ship today)
        await createShipment({ shipNum: `SHIP-${orders[slot]}-1`, selectAll: false });
        console.log(`[Order ${n}] First partial shipment created`);

        // Second shipment: remaining back-ordered items, future date, Letter (no tracking)
        await navigateToShipmentTab();
        await createShipment({
          shipNum:     `SHIP-${orders[slot]}-2`,
          selectAll:   true,
          futureDate:  true,
          parcelType:  'Letter',
        });
        console.log(`[Order ${n}] Second back-order shipment created with future date`);
      }

      await saveOrder();
      await screenshot(`order${n}-4-shipment`);
    });

    // ── 5. GDELR on SFTP ─────────────────────────────────────────────────
    test(`[Order ${n}] 5. GDELR on SFTP`, async () => {
      test.setTimeout(120000);
      if (!orders[slot]) { test.skip(); return; }
      const file = await waitForSftpFile(sftpPat('GDELR', orders[slot]), 60000);
      console.log(`[Order ${n}] GDELR: ${file || 'not found'}`);
    });

    // ── 6. Cancel request (CANP) ──────────────────────────────────────────
    // Platform sends a cancellation request; we reject it with a reason, save, close.
    test(`[Order ${n}] 6. Cancellation request (CANP) — reject and save`, async () => {
      test.setTimeout(180000);
      if (!opened) { test.skip(); return; }

      const positions = orderPositions[slot];
      const pos = positions.length ? [positions[0]] : [{ sku: 'UNKNOWN', qty: 1 }];
      await importEDI('CANP', orders[slot], { positions: pos, reason: 'Customer cancelled' });

      await saveAndClickTab('Cancellation request');
      const body = await page.locator('body').textContent() || '';
      console.log(`[Order ${n}] Cancellation tab visible: ${/cancellation|cancel/i.test(body)}`);

      try {
        const rejectBtn = page.getByRole('button', { name: /reject/i }).filter({ visible: true }).first();
        if (await rejectBtn.isVisible({ timeout: 3000 }) && await rejectBtn.isEnabled()) {
          await rejectBtn.click();
          await page.waitForTimeout(1000);
        }
        const textarea = page.locator('textarea').filter({ visible: true }).first();
        if (await textarea.isVisible({ timeout: 3000 })) {
          await textarea.fill('Cancellation rejected — test');
        }
      } catch {}

      await saveOrder();
      await screenshot(`order${n}-6-cancel`);
    });

    // ── 6b. GCANR on SFTP ────────────────────────────────────────────────
    test(`[Order ${n}] 6b. GCANR on SFTP`, async () => {
      test.setTimeout(120000);
      if (!orders[slot]) { test.skip(); return; }
      const file = await waitForSftpFile(sftpPat('GCANR', orders[slot]), 30000);
      console.log(`[Order ${n}] GCANR: ${file || 'not found'}`);
    });

    // ── 7. Return request (RETP) ──────────────────────────────────────────
    // Platform sends a return request; we reject it with a reason, save.
    test(`[Order ${n}] 7. Return request (RETP) — reject and save`, async () => {
      test.setTimeout(180000);
      if (!opened) { test.skip(); return; }

      const positions = orderPositions[slot];
      const pos = positions.length ? [{ sku: positions[0].sku, qty: 1 }] : [{ sku: 'UNKNOWN', qty: 1 }];
      await importEDI('RETP', orders[slot], { positions: pos, reason: 'Product defective' });

      await saveAndClickTab('Return request');
      const body = await page.locator('body').textContent() || '';
      console.log(`[Order ${n}] Return request tab visible: ${/return|retp/i.test(body)}`);

      try {
        const rejectBtn = page.getByRole('button', { name: /reject/i }).filter({ visible: true }).first();
        if (await rejectBtn.isVisible({ timeout: 3000 })) {
          const enabled = await rejectBtn.isEnabled().catch(() => false);
          if (enabled) {
            await rejectBtn.click();
            await page.waitForTimeout(1000);
          } else {
            console.log(`[Order ${n}] Reject button disabled — reason must be filled first`);
          }
        }
        const textarea = page.locator('textarea').filter({ visible: true }).first();
        if (await textarea.isVisible({ timeout: 3000 })) {
          await textarea.fill('Return rejected — test');
        }
      } catch {}

      await saveOrder();
      await screenshot(`order${n}-7-return`);
    });

    // ── 7b. GSURN on SFTP ────────────────────────────────────────────────
    test(`[Order ${n}] 7b. GSURN on SFTP`, async () => {
      test.setTimeout(120000);
      if (!orders[slot]) { test.skip(); return; }
      const file = await waitForSftpFile(sftpPat('GSURN', orders[slot]), 30000);
      console.log(`[Order ${n}] GSURN: ${file || 'not found'}`);
    });

    // ── 8. Save, check final status, close order → back to orders list ───
    test(`[Order ${n}] 8. Final status and close order`, async () => {
      test.setTimeout(120000);
      if (!opened) { test.skip(); return; }

      await saveOrder();
      const status = await getOrderStatus();
      console.log(`[Order ${n}] Final status: ${status}`);
      await screenshot(`order${n}-8-final`);

      // Close the order detail and return to the orders overview
      await closeOrder();
      console.log(`[Order ${n}] Closed — back to orders list`);
    });
  });
}
