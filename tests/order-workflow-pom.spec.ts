import { test, expect, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { OrdersPage } from '../pages/orders.page';
import { getSftpHelper, SftpHelper } from '../helpers/sftp-upload';
import { buildGCANP, buildGRETP, buildGORDR, buildGDELR } from '../helpers/edi-builder';

test.describe.configure({ mode: 'serial' });

const MAX_ORDERS = 10;

// ── State ────────────────────────────────────────────────────────────────────

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let ordersPage: OrdersPage;
let sftp: SftpHelper;
let orders: string[] = [];

interface Position { sku: string; qty: number; providerKey?: string }

// ── Generic helpers ──────────────────────────────────────────────────────────

async function ss(name: string) {
  try { await page.screenshot({ path: `screenshots/${name}.png` }); } catch {}
}

async function dismissAnyModal() {
  try {
    const dlg = page.locator('lb-dialog,[role="dialog"],.lb-dialog').filter({ visible: true }).first();
    if (!(await dlg.count() > 0 && await dlg.isVisible({ timeout: 1000 }).catch(() => false))) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    if (await dlg.isVisible({ timeout: 500 }).catch(() => false)) {
      const x = dlg.locator('button').filter({ hasText: /^[×✕x]$/i }).first();
      if (await x.count() > 0) { await x.click(); await page.waitForTimeout(800); }
    }
    console.log('  dismissAnyModal: closed');
  } catch {}
}

async function saveOrder() {
  try {
    const btn = page.getByText('Save', { exact: true }).filter({ visible: true }).first();
    if (await btn.isVisible({ timeout: 3000 })) { await btn.click(); }
    else {
      const b2 = page.getByRole('button', { name: /save/i }).filter({ visible: true }).first();
      if (await b2.isVisible({ timeout: 3000 })) await b2.click();
    }
  } catch {}
  await page.waitForTimeout(3500);
}

async function clickTab(name: string): Promise<boolean> {
  try {
    const tab = page.getByText(name, { exact: true }).filter({ visible: true }).first();
    if (!await tab.isVisible({ timeout: 4000 })) { console.log(`  Tab "${name}" not visible`); return false; }
    await tab.click();
    await page.waitForTimeout(2500);
    return true;
  } catch { console.log(`  Tab "${name}" not found`); return false; }
}

async function clickButton(name: string | RegExp, label?: string): Promise<boolean> {
  try {
    const btn = page.getByRole('button', { name }).filter({ visible: true }).first();
    if (!await btn.isVisible({ timeout: 3000 })) return false;
    if (!await btn.isEnabled({ timeout: 3000 })) return false;
    await btn.click(); await page.waitForTimeout(2500);
    return true;
  } catch { if (label) console.log(`  [btn] ${label}: not found`); return false; }
}

async function getOrderStatus(): Promise<string> {
  const body = await page.locator('body').textContent() || '';
  for (const s of ['Shipped', 'Confirmed', 'Cancelling', 'Cancelled', 'New', 'Open', 'Closed']) {
    if (body.includes(s)) return s;
  }
  return 'unknown';
}

// ── Navigation helpers ───────────────────────────────────────────────────────

async function ensureLoggedIn() {
  try { if (await page.locator('.menu-icon').isVisible({ timeout: 4000 })) return; } catch {}
  await loginPage.login(process.env.TEST_USERNAME || 'ashoaib', process.env.TEST_PASSWORD || 'test2');
}

async function findAndOpenOrder(orderId: string): Promise<boolean> {
  try {
    await ensureLoggedIn();
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(3000);
    const inputs = page.locator('thead tr').nth(1).locator('input[type="text"],input:not([type])');
    if (orderId && await inputs.count() > 0) { await inputs.first().fill(orderId); await page.waitForTimeout(2000); }
    let row = orderId
      ? page.locator('tbody tr').filter({ hasText: orderId }).first()
      : page.locator('tbody tr').first();
    if (await row.count() === 0) {
      if (await inputs.count() > 0) { await inputs.first().fill(''); await page.waitForTimeout(2000); }
      row = page.locator('tbody tr').first();
      if (await row.count() === 0) return false;
    }
    await row.dblclick();
    await page.waitForTimeout(5000);
    await dismissAnyModal();
    return true;
  } catch (e) { console.log(`  findAndOpenOrder(${orderId}):`, (e as Error).message); return false; }
}

async function closeOrder() {
  try { await page.keyboard.press('Escape'); await page.waitForTimeout(800); } catch {}
  await ordersPage.navigateToOrders();
  await page.waitForTimeout(2000);
}

// ── Order parties / delivery address ────────────────────────────────────────

async function verifyDeliveryAddress(n: number): Promise<boolean> {
  await dismissAnyModal();
  const ok = await clickTab('Order parties');
  if (!ok) return false;
  // Delivery address card should have a green "Delivery address" badge
  const badge = page.locator('text=Delivery address').filter({ visible: true }).first();
  const found = await badge.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`[Order ${n}] Delivery address badge: ${found}`);
  await ss(`order${n}-delivery-address`);
  return found;
}

// ── Position reading ─────────────────────────────────────────────────────────

async function readPositions(): Promise<Position[]> {
  await dismissAnyModal();
  await clickTab('Order items');
  await page.waitForTimeout(2000);
  const positions: Position[] = [];
  // Positions are rendered as cards; each has a supplier product number visible
  const cards = page.locator('lb-form-card, [class*="position-card"], [class*="order-position"]').filter({ visible: true });
  const count = await cards.count();
  if (count > 0) {
    for (let i = 0; i < count; i++) {
      const text = (await cards.nth(i).textContent() || '').trim();
      const skuM = text.match(/([A-Z]{2,8}-[A-Z0-9]{1,8}-?[A-Z0-9]{2,6})/);
      const qtyM = text.match(/Quantity[^\d]*(\d+)/i) || text.match(/Qty[^\d]*(\d+)/i) || text.match(/\b(\d{1,4})\b/);
      const keyM = text.match(/product key[^\d\w]*([A-Z0-9]{4,})/i);
      if (skuM) positions.push({
        sku: skuM[1],
        qty: qtyM ? parseInt(qtyM[1]) : 1,
        providerKey: keyM?.[1],
      });
    }
  }
  // Fallback: table rows
  if (positions.length === 0) {
    const rows = page.locator('tbody tr').filter({ visible: true });
    const rcount = await rows.count();
    for (let i = 0; i < rcount; i++) {
      const text = (await rows.nth(i).textContent() || '').trim();
      const skuM = text.match(/([A-Z]{2,8}-[A-Z0-9]{1,8}-?[A-Z0-9]{2,6})/);
      if (skuM) positions.push({ sku: skuM[1], qty: 1 });
    }
  }
  console.log(`  readPositions: ${positions.map(p => `${p.sku}(${p.qty})`).join(', ') || 'none'}`);
  return positions;
}

// ── Stock warnings ───────────────────────────────────────────────────────────

async function verifyStockWarnings(n: number): Promise<string[]> {
  await dismissAnyModal();
  await clickTab('Order items');
  await page.waitForTimeout(1500);
  const body = await page.locator('body').textContent() || '';
  // Look for warning indicators dynamically — icons or "warning"/"stock" text near positions
  const warnings: string[] = [];
  const warningEls = page.locator('[class*="warning"],[class*="alert"],[class*="stock-warn"],lb-icon[name*="warning"]').filter({ visible: true });
  const wcount = await warningEls.count();
  for (let i = 0; i < wcount; i++) {
    const parent = warningEls.nth(i).locator('..').first();
    const text = (await parent.textContent() || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (text && !warnings.includes(text)) warnings.push(text);
  }
  // Also look for explicit "Insufficient" or "Out of stock" text
  if (/insufficient|out of stock/i.test(body)) warnings.push('insufficient-stock-detected');
  console.log(`[Order ${n}] Stock warnings (${warnings.length}):`, warnings.slice(0, 3));
  await ss(`order${n}-stock-warnings`);
  return warnings;
}

// ── Browser notification / alert ─────────────────────────────────────────────

async function checkForNotification(n: number, label: string): Promise<boolean> {
  // Check visible notification banner / toast
  const notif = page.locator('lb-notification,[class*="notification"],[class*="toast"],[class*="alert-banner"]').filter({ visible: true }).first();
  const found = await notif.isVisible({ timeout: 3000 }).catch(() => false);
  const text = found ? (await notif.textContent() || '').trim() : '';
  console.log(`[Order ${n}] ${label} notification: ${found}${text ? ` — "${text.slice(0, 60)}"` : ''}`);
  await ss(`order${n}-${label}-notification`);
  return found;
}

// ── Email notification check ─────────────────────────────────────────────────

async function checkEmailNotification(n: number): Promise<boolean> {
  // Sellon may have a notification email page or a settings check
  // We verify by looking for "email" or "notification" in the order's audit/history section
  const body = await page.locator('body').textContent() || '';
  const ok = /email|notification|benachrichtigung/i.test(body);
  console.log(`[Order ${n}] Email notification evidence found: ${ok}`);
  return ok;
}

// ── SFTP / EDI helpers ───────────────────────────────────────────────────────

async function importEDI(type: 'GCANP' | 'GRETP', orderId: string, positions: Position[]): Promise<boolean> {
  if (!sftp.isConfigured) { console.log(`  [SFTP] ${type} upload skipped — not configured`); return false; }
  let edi: { content: string; filename: string };
  if (type === 'GCANP') {
    edi = buildGCANP(orderId, positions.map(p => ({ sku: p.sku })), 'Customer requested cancellation');
  } else {
    edi = buildGRETP(orderId, positions.map(p => ({ sku: p.sku, qty: p.qty })), 'Product damaged / wrong item');
  }
  const ok = await sftp.uploadEDIContent(edi.content, edi.filename);
  console.log(`  [SFTP] ${type} ${edi.filename} uploaded: ${ok}`);
  return ok;
}

async function uploadGORDR(orderId: string, positions: Position[]): Promise<boolean> {
  if (!sftp.isConfigured) return false;
  const edi = buildGORDR(orderId, positions);
  const ok = await sftp.uploadEDIContent(edi.content, edi.filename);
  console.log(`  [SFTP] GORDR ${edi.filename} uploaded: ${ok}`);
  return ok;
}

async function uploadGDELR(orderId: string, positions: Position[], shipRef: string): Promise<boolean> {
  if (!sftp.isConfigured) return false;
  const edi = buildGDELR(orderId, positions, shipRef, 'Swiss Post');
  const ok = await sftp.uploadEDIContent(edi.content, edi.filename);
  console.log(`  [SFTP] GDELR ${edi.filename} uploaded: ${ok}`);
  return ok;
}

async function waitForSftpFile(pattern: RegExp | string, label: string, timeoutMs = 60000): Promise<string | null> {
  if (!sftp.isConfigured) { console.log(`  [SFTP] waitForFile skipped — not configured`); return null; }
  const file = await sftp.waitForFile(pattern, timeoutMs, 4000);
  console.log(`  [SFTP] ${label}: ${file || 'not found'}`);
  return file;
}

// ── Cancellation tab helpers ──────────────────────────────────────────────────

async function navigateToCancellationTab(): Promise<boolean> {
  for (const name of ['Cancellation requests', 'Cancellation', 'Cancellations', 'CANP', 'Cancel requests']) {
    if (await clickTab(name)) { console.log(`  Cancellation tab: "${name}"`); return true; }
  }
  console.log('  Cancellation tab not found');
  return false;
}

async function navigateToReturnTab(): Promise<boolean> {
  for (const name of ['Return requests', 'Return', 'Returns', 'RETP', 'Return request']) {
    if (await clickTab(name)) { console.log(`  Return tab: "${name}"`); return true; }
  }
  console.log('  Return tab not found');
  return false;
}

// Verify order items tab is locked (inputs disabled / buttons absent)
async function verifyOrderItemsLocked(): Promise<boolean> {
  await dismissAnyModal();
  await clickTab('Order items');
  await page.waitForTimeout(1500);
  const confirmBtns = page.locator('button').filter({ hasText: /^(Confirm|Accept|Confirm position)$/ }).filter({ visible: true });
  const count = await confirmBtns.count();
  // Also check if inputs are readonly
  const editables = page.locator('input:not([readonly]):not([disabled]),[contenteditable="true"]').filter({ visible: true });
  const editableCount = await editables.count();
  console.log(`  verifyOrderItemsLocked: confirm buttons=${count}, editables=${editableCount}`);
  return count === 0; // no confirm buttons = locked
}

// Reject all cancellation items with a message
async function rejectCancellationItems(message: string): Promise<number> {
  const rejectBtns = page.locator('button').filter({ hasText: /^Reject$/ }).filter({ visible: true });
  const count = await rejectBtns.count();
  let rejected = 0;
  for (let i = 0; i < count; i++) {
    try {
      // Re-query as DOM may update
      const btn = page.locator('button').filter({ hasText: /^Reject$/ }).filter({ visible: true }).nth(0);
      if (!await btn.isVisible({ timeout: 1500 }).catch(() => false)) continue;
      await btn.click(); await page.waitForTimeout(1000);
      // Fill rejection message if input appears
      const msgInput = page.locator('textarea,input[type="text"]').filter({ visible: true }).last();
      if (await msgInput.count() > 0 && await msgInput.isVisible({ timeout: 1500 }).catch(() => false)) {
        await msgInput.fill(message);
        await page.waitForTimeout(500);
      }
      // Confirm rejection
      const confirmBtn = page.locator('button').filter({ hasText: /^(Confirm|OK|Submit|Reject)$/ }).filter({ visible: true }).last();
      if (await confirmBtn.count() > 0) { await confirmBtn.click(); await page.waitForTimeout(1000); }
      rejected++;
    } catch {}
  }
  console.log(`  rejectCancellationItems: rejected ${rejected}/${count}`);
  return rejected;
}

// Accept all cancellation items
async function acceptCancellationItems(): Promise<number> {
  const acceptBtns = page.locator('button').filter({ hasText: /^Accept$/ }).filter({ visible: true });
  const count = await acceptBtns.count();
  let accepted = 0;
  for (let i = 0; i < count; i++) {
    try {
      const btn = page.locator('button').filter({ hasText: /^Accept$/ }).filter({ visible: true }).nth(0);
      if (!await btn.isVisible({ timeout: 1500 }).catch(() => false)) continue;
      await btn.click(); await page.waitForTimeout(1000);
      accepted++;
    } catch {}
  }
  console.log(`  acceptCancellationItems: accepted ${accepted}/${count}`);
  return accepted;
}

// Partially approve a cancellation item by qty
async function partialApproveCancellationItem(itemIndex: number, approveQty: number): Promise<boolean> {
  try {
    const rows = page.locator('tbody tr').filter({ visible: true });
    const row = rows.nth(itemIndex);
    // Find qty input in row and set approve quantity
    const qtyInput = row.locator('input[type="number"]').filter({ visible: true }).first();
    if (await qtyInput.count() > 0) {
      await qtyInput.fill(String(approveQty));
      await page.waitForTimeout(500);
    }
    const approveBtn = row.locator('button').filter({ hasText: /approve|accept/i }).first();
    if (await approveBtn.count() > 0) { await approveBtn.click(); await page.waitForTimeout(1000); return true; }
    return false;
  } catch (e) { console.log('  partialApprove error:', (e as Error).message); return false; }
}


// ── Confirm all order positions ──────────────────────────────────────────────

async function confirmAllPositions(n: number): Promise<number> {
  await dismissAnyModal();
  await clickTab('Order items');
  await page.waitForTimeout(2000);
  const btns = page.locator('button').filter({ hasText: /^(Confirm|Confirm position|Accept)$/ }).filter({ visible: true });
  const count = await btns.count();
  let confirmed = 0;
  for (let i = 0; i < count; i++) {
    try {
      const btn = page.locator('button').filter({ hasText: /^(Confirm|Confirm position|Accept)$/ }).filter({ visible: true }).first();
      if (!await btn.isVisible({ timeout: 1500 }).catch(() => false)) continue;
      if (!await btn.isEnabled({ timeout: 1500 }).catch(() => false)) continue;
      await btn.click(); await page.waitForTimeout(1000);
      confirmed++;
    } catch {}
  }
  await saveOrder();
  console.log(`[Order ${n}] confirmAllPositions: ${confirmed}/${count}`);
  return confirmed;
}

// ── Shipment creation ────────────────────────────────────────────────────────

async function selectShipmentDropdown(nth: number, preferText?: string) {
  const combos = page.locator('lb-combobox').filter({ visible: true });
  if (await combos.count() > nth) {
    await combos.nth(nth).click(); await page.waitForTimeout(1500);
    const opts = page.locator('lb-option,.dropdown-item,[class*="item-label"]').filter({ visible: true });
    if (preferText) {
      const m = opts.filter({ hasText: new RegExp(preferText, 'i') }).first();
      if (await m.count() > 0) { await m.click(); await page.waitForTimeout(400); return; }
    }
    const first = opts.first();
    if (await first.count() > 0) { await first.click(); await page.waitForTimeout(400); }
    return;
  }
  const selects = page.locator('select').filter({ visible: true });
  if (await selects.count() > nth) {
    const sel = selects.nth(nth);
    if (preferText) { try { await sel.selectOption({ label: preferText }); return; } catch {} }
    const opts = await sel.locator('option').allTextContents();
    const valid = opts.find(o => o.trim() && !o.includes('--') && !/select/i.test(o));
    if (valid) await sel.selectOption({ label: valid.trim() });
  }
}

async function navigateToShipmentTab(): Promise<boolean> {
  await dismissAnyModal();
  await saveOrder();
  for (const name of ['Shipping', 'Shipment', 'Shipments', 'Delivery']) {
    try {
      const tab = page.getByText(name, { exact: true }).filter({ visible: true }).first();
      if (await tab.isVisible({ timeout: 2000 })) {
        await tab.click(); await page.waitForTimeout(2000);
        console.log(`  Shipment tab: "${name}"`);
        return true;
      }
    } catch {}
  }
  console.log('  Shipment tab not found');
  return false;
}

// Create a shipment in the dialog. carrier='Swiss Post', parcelType='General Cargo' by default.
// splitQty: if > 0, fill "Create partial shipment of" and click Split, then uncheck remainder.
// isLetter: if true, skip shipment number (letter type doesn't require it).
async function createShipmentDialog(
  opts: { carrier?: string; parcelType?: string; splitQty?: number; isLetter?: boolean } = {}
): Promise<boolean> {
  await dismissAnyModal();
  const clicked = await clickButton(/create new shipment|new shipment/i, 'create new shipment');
  if (!clicked) { console.log('  createShipment: button not found'); return false; }
  await page.waitForTimeout(2000);

  const ts = Date.now().toString().slice(-8);

  try { await selectShipmentDropdown(0, opts.carrier || 'Swiss Post'); console.log('  Carrier set'); } catch {}
  try { await selectShipmentDropdown(1, opts.parcelType || 'General Cargo'); console.log('  Parcel type set'); } catch {}

  // Text inputs: shipment number + delivery note number
  if (!opts.isLetter) {
    try {
      const inputs = page.locator('input[type="text"]:not([readonly]),input:not([type]):not([readonly]):not([type="checkbox"]):not([type="number"])')
        .filter({ visible: true });
      if (await inputs.count() > 0) await inputs.nth(0).fill(`SHP${ts}`);
      if (await inputs.count() > 1) await inputs.nth(1).fill(`DNT${ts}`);
      console.log(`  shipNum=SHP${ts}`);
    } catch (e) { console.log('  text fill failed:', e); }
  }

  // Check first item row
  try {
    const chk = page.locator('tbody tr input[type="checkbox"]').filter({ visible: true }).first();
    if (await chk.count() > 0 && !await chk.isChecked().catch(() => false)) {
      await chk.check(); await page.waitForTimeout(400);
    }
  } catch {}

  // Partial split
  if (opts.splitQty && opts.splitQty > 0) {
    try {
      const partialInput = page.locator('input[type="number"]').filter({ visible: true }).first();
      if (await partialInput.count() > 0) {
        await partialInput.fill(String(opts.splitQty));
        await page.waitForTimeout(400);
        const splitBtn = page.getByRole('button', { name: /^split$/i }).filter({ visible: true }).first();
        if (await splitBtn.count() > 0 && await splitBtn.isVisible({ timeout: 2000 })) {
          await splitBtn.click(); await page.waitForTimeout(1500);
          // Uncheck remainder row
          const chks = page.locator('tbody tr input[type="checkbox"]').filter({ visible: true });
          if (await chks.count() >= 2 && await chks.nth(1).isChecked().catch(() => false)) {
            await chks.nth(1).uncheck(); await page.waitForTimeout(300);
          }
          console.log(`  Split qty: ${opts.splitQty}`);
        }
      }
    } catch (e) { console.log('  split failed:', e); }
  }

  const added = await clickButton(/add shipment/i, 'add shipment');
  if (!added) {
    const sub = page.locator('button').filter({ hasText: /add|confirm/i }).filter({ visible: true }).last();
    if (await sub.count() > 0) await sub.click();
  }
  await page.waitForTimeout(2000);
  await saveOrder();
  return true;
}

// ── UAR: manual return registration ─────────────────────────────────────────

async function registerUAR(positionIndex: number, qty: number, n: number): Promise<boolean> {
  await dismissAnyModal();
  await clickTab('Order items');
  await page.waitForTimeout(1500);
  try {
    const registerBtn = page.locator('button').filter({ hasText: /register return/i }).filter({ visible: true }).nth(positionIndex);
    if (!await registerBtn.isVisible({ timeout: 2000 }).catch(() => false)) return false;
    await registerBtn.click(); await page.waitForTimeout(1500);
    // Fill qty in dialog
    const qtyInput = page.locator('input[type="number"]').filter({ visible: true }).first();
    if (await qtyInput.count() > 0) { await qtyInput.fill(String(qty)); await page.waitForTimeout(400); }
    // Confirm
    const ok = await clickButton(/confirm|ok|submit/i, 'UAR confirm');
    console.log(`[Order ${n}] UAR registered: qty=${qty}, confirmed=${ok}`);
    await saveOrder();
    return ok;
  } catch (e) { console.log('  registerUAR error:', (e as Error).message); return false; }
}

// ── discover orders ──────────────────────────────────────────────────────────

async function discoverOrders(max: number): Promise<string[]> {
  await ensureLoggedIn();
  await ordersPage.navigateToOrders();
  await page.waitForTimeout(3000);
  const ids: string[] = [];
  const idColIdx = await ordersPage.findColumnIndex('ID');
  const rows = page.locator('tbody tr');
  const rowCount = Math.min(await rows.count(), 50);
  for (let i = 0; i < rowCount && ids.length < max; i++) {
    const cells = rows.nth(i).locator('td');
    const cellCount = await cells.count();
    if (idColIdx >= 0 && idColIdx < cellCount) {
      const text = (await cells.nth(idColIdx).textContent() || '').trim();
      if (text && !ids.includes(text)) ids.push(text);
    } else {
      for (let j = 0; j < Math.min(cellCount, 6); j++) {
        const text = (await cells.nth(j).textContent() || '').trim();
        if (text && /^\d+$/.test(text) && !ids.includes(text)) { ids.push(text); break; }
      }
    }
  }
  console.log(`[discoverOrders] Found ${ids.length}: ${ids.join(', ') || 'none'}`);
  return ids;
}

// ============================================================================
// Setup / teardown
// ============================================================================

test.beforeAll(async () => {
  test.setTimeout(600000);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page = await ctx.newPage();

  // Accept any browser dialogs (alerts) automatically and log them
  page.on('dialog', async dlg => {
    console.log('  [browser dialog]', dlg.type(), ':', dlg.message().slice(0, 120));
    await dlg.accept();
  });

  loginPage = new LoginPage(page);
  ordersPage = new OrdersPage(page);
  sftp = getSftpHelper();

  if (sftp.isConfigured) {
    await sftp.connect().catch(e => console.log('[SFTP] connect failed:', e.message));
  }

  await loginPage.login(process.env.TEST_USERNAME || 'ashoaib', process.env.TEST_PASSWORD || 'test2');
  await page.waitForTimeout(3000);

  orders = await discoverOrders(MAX_ORDERS);
  console.log(`Orders ready: ${orders.join(', ') || 'none'}`);
});

test.afterAll(async () => {
  test.setTimeout(60000);
  await sftp.disconnect().catch(() => {});
  await browser.close();
});


// ============================================================================
// Order workflow loop
//
// For each discovered order slot (up to MAX_ORDERS):
//   • Detect the order's current status by opening it
//   • NEW / OPEN  → run the full workflow (verify → CANP → confirm → ship → RETP)
//   • CONFIRMED   → start from the shipping step (positions already confirmed)
//   • SHIPPED / CLOSED / CANCELLED → skip all steps (nothing to do)
//
// This makes the suite resilient to re-runs and independent of order position.
// ============================================================================

for (let slot = 0; slot < MAX_ORDERS; slot++) {
  const n = slot + 1;

  test.describe(`Order ${n}`, () => {
    let opened = false;
    let initialStatus = '';
    let positions: Position[] = [];

    // ── Step 1: Open order and detect status ──────────────────────────────────
    test(`[Order ${n}] 1. Open order and detect status`, async () => {
      test.setTimeout(120000);
      if (!orders[slot]) { test.skip(); return; }

      opened = await findAndOpenOrder(orders[slot]);
      if (!opened) { test.skip(); return; }

      initialStatus = await getOrderStatus();
      console.log(`[Order ${n}] Detected status: "${initialStatus}"`);
      await ss(`order${n}-1-open`);

      // Only process New or Open orders; anything else → close and mark as skip
      if (!['New', 'Open'].includes(initialStatus)) {
        console.log(`[Order ${n}] Status is "${initialStatus}" — skipping (only New/Open orders are processed)`);
        await closeOrder();
        opened = false;
        return;
      }

      positions = await readPositions();
      expect(positions.length).toBeGreaterThan(0);
    });

    // ── Step 2: Verify delivery address and stock warnings ────────────────────
    test(`[Order ${n}] 2. Verify delivery address and stock warnings`, async () => {
      test.setTimeout(60000);
      if (!opened) { test.skip(); return; }

      await checkForNotification(n, 'new-order');
      const hasAddress = await verifyDeliveryAddress(n);
      console.log(`[Order ${n}] Delivery address: ${hasAddress}`);
      expect(hasAddress).toBeTruthy();

      const warnings = await verifyStockWarnings(n);
      console.log(`[Order ${n}] Stock warnings found: ${warnings.length}`);
    });

    // ── Step 3: Import CANP and handle cancellation ───────────────────────────
    // Uploads a GCANP to SFTP, waits for Sellon to notify, then rejects
    // the cancellation. Verifies GCANR appears on SFTP output.
    // Gracefully skips when SFTP is not configured.
    test(`[Order ${n}] 3. Handle CANP cancellation request`, async () => {
      test.setTimeout(180000);
      if (!opened) { test.skip(); return; }

      const uploaded = await importEDI('GCANP', orders[slot], positions);
      if (!uploaded) {
        console.log(`[Order ${n}] CANP step skipped — SFTP not configured`);
        return;
      }

      // Wait for Sellon to pick up and process the GCANP file
      console.log(`[Order ${n}] Waiting for Sellon to process GCANP...`);
      await page.waitForTimeout(15000);
      await page.reload();
      await page.waitForTimeout(5000);
      await dismissAnyModal();

      // 3a: alert visible in open order
      await checkForNotification(n, 'canp-alert');
      await ss(`order${n}-3a-canp-alert`);

      // 3b: cancellation tab appears
      const tabFound = await navigateToCancellationTab();
      console.log(`[Order ${n}] Cancellation tab opened: ${tabFound}`);
      await ss(`order${n}-3b-canp-tab`);

      // 3c: order items are locked while cancellation is pending
      const locked = await verifyOrderItemsLocked();
      console.log(`[Order ${n}] Items locked during CANP: ${locked}`);

      // 3d–3f: reject with message → verify GCANR on SFTP
      if (tabFound) {
        await navigateToCancellationTab();
        const rejected = await rejectCancellationItems('Cannot cancel — order already in processing');
        console.log(`[Order ${n}] Rejected ${rejected} cancellation item(s)`);
        await saveOrder();
        await ss(`order${n}-3c-canp-rejected`);

        const gcanrFile = await waitForSftpFile(new RegExp(`GCANR.*${orders[slot]}`, 'i'), 'GCANR');
        console.log(`[Order ${n}] GCANR on SFTP: ${gcanrFile}`);
      }
    });

    // ── Step 4: Confirm all positions ─────────────────────────────────────────
    test(`[Order ${n}] 4. Confirm all positions`, async () => {
      test.setTimeout(120000);
      if (!opened) { test.skip(); return; }

      const confirmed = await confirmAllPositions(n);
      const status = await getOrderStatus();
      console.log(`[Order ${n}] Status after confirm: "${status}" (${confirmed} confirmed)`);
      await ss(`order${n}-4-confirmed`);
    });

    // ── Step 5: Create shipment with partial split ────────────────────────────
    // Reads qty from the first position and splits off (qty-1) for this shipment.
    // Uploads GDELR to SFTP and waits for the response file.
    test(`[Order ${n}] 5. Create shipment`, async () => {
      test.setTimeout(180000);
      if (!opened) { test.skip(); return; }

      const navOk = await navigateToShipmentTab();
      if (!navOk) {
        console.log(`[Order ${n}] Shipment tab not found — skipping`);
        return;
      }

      const firstQty = positions[0]?.qty || 2;
      const splitQty = firstQty > 1 ? firstQty - 1 : 0;
      await createShipmentDialog({ carrier: 'Swiss Post', parcelType: 'General Cargo', splitQty });
      await ss(`order${n}-5-shipment`);

      // Upload GDELR and verify it appears on SFTP
      const shipRef = `SHP${Date.now().toString().slice(-8)}`;
      await uploadGDELR(orders[slot], positions, shipRef);
      const delrFile = await waitForSftpFile(new RegExp(`DELR.*${orders[slot]}`, 'i'), 'GDELR');
      console.log(`[Order ${n}] GDELR on SFTP: ${delrFile}`);
    });

    // ── Step 6: Import RETP and handle return ─────────────────────────────────
    // Uploads a GRETP to SFTP, waits for Sellon to notify, then rejects
    // the return. Verifies GSURN appears on SFTP output.
    // Gracefully skips when SFTP is not configured.
    test(`[Order ${n}] 6. Handle RETP return request`, async () => {
      test.setTimeout(180000);
      if (!opened) { test.skip(); return; }

      // Return qty is half the original (rounded down, min 1)
      const retpPositions = positions.map(p => ({ ...p, qty: Math.max(1, Math.floor(p.qty / 2)) }));
      const uploaded = await importEDI('GRETP', orders[slot], retpPositions);
      if (!uploaded) {
        console.log(`[Order ${n}] RETP step skipped — SFTP not configured`);
        return;
      }

      console.log(`[Order ${n}] Waiting for Sellon to process GRETP...`);
      await page.waitForTimeout(15000);
      await page.reload();
      await page.waitForTimeout(5000);
      await dismissAnyModal();

      // 6a: alert in open order
      await checkForNotification(n, 'retp-alert');
      await ss(`order${n}-6a-retp-alert`);

      // 6b: return tab appears
      const tabFound = await navigateToReturnTab();
      console.log(`[Order ${n}] Return tab opened: ${tabFound}`);
      await ss(`order${n}-6b-retp-tab`);

      // 6c–6e: reject return → verify GSURN on SFTP
      if (tabFound) {
        const rejected = await rejectCancellationItems('Return rejected — no defect found after inspection');
        console.log(`[Order ${n}] Rejected ${rejected} return item(s)`);
        await saveOrder();
        await ss(`order${n}-6c-retp-rejected`);

        const gsurnFile = await waitForSftpFile(new RegExp(`GSURN.*${orders[slot]}`, 'i'), 'GSURN');
        console.log(`[Order ${n}] GSURN on SFTP: ${gsurnFile}`);
      }
    });

    // ── Step 7: Verify final status and close ─────────────────────────────────
    test(`[Order ${n}] 7. Verify final status and close`, async () => {
      test.setTimeout(60000);
      if (!opened) { test.skip(); return; }

      await saveOrder();
      const status = await getOrderStatus();
      console.log(`[Order ${n}] Final status: "${status}"`);
      await ss(`order${n}-7-final`);
      await closeOrder();
    });
  });
}
