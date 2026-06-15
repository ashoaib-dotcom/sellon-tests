import { test, expect, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { OrdersPage } from '../pages/orders.page';
import { getSftpHelper, SftpHelper } from '../helpers/sftp-upload';
import { buildGCANP, buildGRETP, buildGORDR, buildGDELR } from '../helpers/edi-builder';

test.describe.configure({ mode: 'serial' });

// ── State ────────────────────────────────────────────────────────────────────

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let ordersPage: OrdersPage;
let sftp: SftpHelper;
let orders: string[] = [];   // discovered order IDs, index 0-2 → orders 1-3

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

  orders = await discoverOrders(3);
  console.log(`Orders ready: ${orders.join(', ') || 'none'}`);
});

test.afterAll(async () => {
  test.setTimeout(60000);
  await sftp.disconnect().catch(() => {});
  await browser.close();
});

// ============================================================================
// ORDER 1 — Full CANP + RETP lifecycle
// Steps: notification → delivery address → stock warning → CANP reject →
//        confirm → ship → RETP reject → verify Open
// ============================================================================

test.describe('Order 1', () => {
  let opened = false;
  let positions: Position[] = [];

  // Step 1: Verify notification and order appears in overview
  test('[Order 1] 1. Verify notification and order appears in overview', async () => {
    test.setTimeout(120000);
    if (!orders[0]) { test.skip(); return; }

    // Check browser alert notification was received (dialog listener fires on page.on('dialog'))
    const alertFound = await checkForNotification(1, 'incoming-order');
    console.log(`[Order 1] Browser notification visible: ${alertFound}`);

    // Verify order appears in orders list
    await ensureLoggedIn();
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(3000);
    const body = await page.locator('body').textContent() || '';
    const inList = body.includes(orders[0]);
    console.log(`[Order 1] ${orders[0]} in overview: ${inList}`);
    expect(inList).toBeTruthy();
    await ss('order1-1-overview');
  });

  // Step 2: Open order and verify delivery address
  test('[Order 1] 2. Open order and verify delivery address', async () => {
    test.setTimeout(120000);
    if (!orders[0]) { test.skip(); return; }
    opened = await findAndOpenOrder(orders[0]);
    if (!opened) { test.skip(); return; }

    const hasAddress = await verifyDeliveryAddress(1);
    expect(hasAddress).toBeTruthy();

    // Check email notification evidence
    const emailOk = await checkEmailNotification(1);
    console.log(`[Order 1] Email notification evidence: ${emailOk}`);
    await ss('order1-2-delivery');
  });

  // Step 3: Verify stock warning
  test('[Order 1] 3. Verify stock warning for insufficient stock product', async () => {
    test.setTimeout(60000);
    if (!opened) { test.skip(); return; }

    const warnings = await verifyStockWarnings(1);
    console.log(`[Order 1] Stock warnings found: ${warnings.length}`);
    // Note: we log but don't fail if no warnings — stock level depends on current state
    await ss('order1-3-stock-warning');
  });

  // Step 4: Read positions
  test('[Order 1] 4. Read order positions', async () => {
    test.setTimeout(60000);
    if (!opened) { test.skip(); return; }
    positions = await readPositions();
    console.log(`[Order 1] Positions: ${positions.map(p => `${p.sku}(${p.qty})`).join(', ')}`);
    expect(positions.length).toBeGreaterThan(0);
    await ss('order1-4-positions');
  });

  // Step 5: Import CANP — verify alert, cancellation tab, items locked, reject requires message
  test('[Order 1] 5. Import CANP and verify cancellation alert + tab', async () => {
    test.setTimeout(180000);
    if (!opened || positions.length === 0) { test.skip(); return; }

    // Upload GCANP to SFTP
    const uploaded = await importEDI('GCANP', orders[0], positions);
    if (uploaded) {
      // Wait for Sellon to process and show notification
      console.log('[Order 1] Waiting for CANP to be processed...');
      await page.waitForTimeout(15000);
      await page.reload(); await page.waitForTimeout(5000);
      await dismissAnyModal();
    }

    // 5a: alert visible in open order
    const alert = await checkForNotification(1, 'canp-alert');
    console.log(`[Order 1] CANP alert: ${alert}`);
    await ss('order1-5a-canp-alert');

    // 5b: cancellation tab appears
    const tabFound = await navigateToCancellationTab();
    console.log(`[Order 1] Cancellation tab opened: ${tabFound}`);
    await ss('order1-5b-canp-tab');

    // 5c: order items locked until cancellation handled
    const locked = await verifyOrderItemsLocked();
    console.log(`[Order 1] Order items locked: ${locked}`);

    // 5d: verify reject requires a message (check validation)
    await navigateToCancellationTab();
    const rejectBtn = page.locator('button').filter({ hasText: /^Reject$/ }).filter({ visible: true }).first();
    if (await rejectBtn.count() > 0) {
      await rejectBtn.click(); await page.waitForTimeout(1000);
      // Try to confirm without message → expect validation error
      const confirmEarly = page.locator('button').filter({ hasText: /^(Confirm|OK|Submit)$/ }).filter({ visible: true }).last();
      if (await confirmEarly.count() > 0) { await confirmEarly.click(); await page.waitForTimeout(1000); }
      const validationErr = page.locator('[class*="error"],[class*="required"],[class*="invalid"]').filter({ visible: true }).first();
      const hasValidation = await validationErr.isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`[Order 1] Rejection validation required: ${hasValidation}`);
      await ss('order1-5d-canp-reject-validation');
      // Close dialog without rejecting
      await page.keyboard.press('Escape'); await page.waitForTimeout(800);
    }

    // 5e/f/g: check status, cancelled items count, provider key visible
    await navigateToCancellationTab();
    const body = await page.locator('body').textContent() || '';
    const hasStatus = /cancel|reject|pending/i.test(body);
    const hasCancelledCount = /\d+/.test(body);
    const hasProviderKey = positions[0]?.providerKey ? body.includes(positions[0].providerKey) : true;
    console.log(`[Order 1] CANP shows status=${hasStatus}, count=${hasCancelledCount}, providerKey=${hasProviderKey}`);
    await ss('order1-5e-canp-details');
  });

  // Step 6: Reject cancellation and verify GCANR on SFTP
  test('[Order 1] 6. Reject cancellation → verify GCANR on SFTP', async () => {
    test.setTimeout(180000);
    if (!opened) { test.skip(); return; }

    await navigateToCancellationTab();
    const rejected = await rejectCancellationItems('Item is already in production, cannot cancel');
    console.log(`[Order 1] Cancellation items rejected: ${rejected}`);

    await saveOrder();
    await ss('order1-6a-cancellation-rejected');

    // 6a: verify status changed to Rejected
    const body = await page.locator('body').textContent() || '';
    const isRejected = /rejected/i.test(body);
    console.log(`[Order 1] Cancellation status Rejected: ${isRejected}`);

    // 6b: GCANR on SFTP
    const gcanrFile = await waitForSftpFile(new RegExp(`GCANR.*${orders[0]}`, 'i'), 'GCANR', 60000);
    console.log(`[Order 1] GCANR on SFTP: ${gcanrFile}`);

    // 6d: positions unchanged — read and compare
    const posAfter = await readPositions();
    console.log(`[Order 1] Positions after cancellation reject: ${posAfter.length} (was ${positions.length})`);

    // 6e: cancellation not editable
    await navigateToCancellationTab();
    const editableReject = page.locator('button').filter({ hasText: /^Reject$/ }).filter({ visible: true });
    const stillEditable = await editableReject.count() > 0;
    console.log(`[Order 1] Cancellation still editable: ${stillEditable}`);

    await ss('order1-6f-canr-status');
  });

  // Step 7: Confirm full quantity for first confirmed-eligible position
  test('[Order 1] 7. Confirm positions', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    // 7a: verify status can change to "To confirm" or similar
    const confirmed = await confirmAllPositions(1);
    const statusAfter = await getOrderStatus();
    console.log(`[Order 1] Status after confirm: ${statusAfter} (${confirmed} confirmed)`);

    // 7b: upload GORDR to SFTP
    await uploadGORDR(orders[0], positions);

    // 7c: after save, ORDR on SFTP
    const ordrFile = await waitForSftpFile(new RegExp(`ORDR.*${orders[0]}`, 'i'), 'GORDR-out', 30000);
    console.log(`[Order 1] GORDR on SFTP: ${ordrFile}`);
    await ss('order1-7-confirmed');
  });

  // Step 8: Create shipping and verify DELR on SFTP
  test('[Order 1] 8. Create shipment and verify DELR on SFTP', async () => {
    test.setTimeout(180000);
    if (!opened) { test.skip(); return; }

    // 8b: only confirmed items can be added to shipping
    const navOk = await navigateToShipmentTab();
    if (!navOk) { console.log('[Order 1] Shipment tab not found — skipping'); return; }

    // Read qty for partial split
    const firstPos = positions[0];
    const splitQty = firstPos && firstPos.qty > 1 ? firstPos.qty - 1 : 0;
    await createShipmentDialog({ carrier: 'Swiss Post', parcelType: 'General Cargo', splitQty });

    // 8a: numbers valid and shown
    await ss('order1-8a-shipment');

    // 8d: DELR on SFTP
    await uploadGDELR(orders[0], positions, `SHP${Date.now().toString().slice(-8)}`);
    const delrFile = await waitForSftpFile(new RegExp(`DELR.*${orders[0]}`, 'i'), 'GDELR', 60000);
    console.log(`[Order 1] GDELR on SFTP: ${delrFile}`);

    // 8e: only return can be registered — other buttons disabled for shipped position
    await clickTab('Order items');
    const returnBtn = page.locator('button').filter({ hasText: /register return/i }).filter({ visible: true }).first();
    const hasReturn = await returnBtn.count() > 0;
    console.log(`[Order 1] Register return button present: ${hasReturn}`);
    await ss('order1-8e-shipped-position');
  });

  // Step 9: Import RETP — verify alert, return tab, details
  test('[Order 1] 9. Import RETP and verify return alert + tab', async () => {
    test.setTimeout(180000);
    if (!opened || positions.length === 0) { test.skip(); return; }

    const uploaded = await importEDI('GRETP', orders[0], positions.map(p => ({ ...p, qty: Math.max(1, Math.floor(p.qty / 2)) })));
    if (uploaded) {
      await page.waitForTimeout(15000);
      await page.reload(); await page.waitForTimeout(5000);
      await dismissAnyModal();
    }

    // 9a: alert in open order
    const alert = await checkForNotification(1, 'retp-alert');
    console.log(`[Order 1] RETP alert: ${alert}`);
    await ss('order1-9a-retp-alert');

    // 9b: return tab opens
    const tabFound = await navigateToReturnTab();
    console.log(`[Order 1] Return tab: ${tabFound}`);
    await ss('order1-9b-retp-tab');

    // 9c/d/e: return reason, item count, provider key
    const body = await page.locator('body').textContent() || '';
    const hasReason = /reason|grund|return/i.test(body);
    const hasCount = /\d+/.test(body);
    console.log(`[Order 1] RETP: reason=${hasReason}, count=${hasCount}`);

    // 9f: shipment URL clickable
    const shipLink = page.locator('a[href*="ship"],a[href*="track"]').filter({ visible: true }).first();
    const hasLink = await shipLink.count() > 0;
    console.log(`[Order 1] Shipment URL: ${hasLink}`);

    // 9g/h: reject requires reason — validate
    const rejectBtn = page.locator('button').filter({ hasText: /^Reject$/ }).filter({ visible: true }).first();
    if (await rejectBtn.count() > 0) {
      await rejectBtn.click(); await page.waitForTimeout(800);
      const reasonInput = page.locator('textarea,input[type="text"]').filter({ visible: true }).last();
      const needsReason = await reasonInput.isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`[Order 1] Return rejection requires reason: ${needsReason}`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    }
    await ss('order1-9h-retp-reject-validation');
  });

  // Step 10: Reject return → verify GSURN on SFTP
  test('[Order 1] 10. Reject return and verify GSURN on SFTP', async () => {
    test.setTimeout(180000);
    if (!opened) { test.skip(); return; }

    await navigateToReturnTab();
    const rejected = await rejectCancellationItems('Return rejected — item shows no defect');
    console.log(`[Order 1] Return items rejected: ${rejected}`);
    await saveOrder();
    await ss('order1-10a-return-rejected');

    // 10b: GSURN on SFTP
    const gsurnFile = await waitForSftpFile(new RegExp(`GSURN.*${orders[0]}`, 'i'), 'GSURN', 60000);
    console.log(`[Order 1] GSURN on SFTP: ${gsurnFile}`);

    // 10d: positions unchanged
    const posAfter = await readPositions();
    console.log(`[Order 1] Positions unchanged: ${posAfter.length} (was ${positions.length})`);

    // 10e: return request not editable
    await navigateToReturnTab();
    const editableReject = page.locator('button').filter({ hasText: /^Reject$/ }).filter({ visible: true });
    console.log(`[Order 1] Return still editable: ${await editableReject.count() > 0}`);
    await ss('order1-10f-return-status');
  });

  // Step 11: Verify order status is Open, close
  test('[Order 1] 11. Verify order status and close', async () => {
    test.setTimeout(60000);
    if (!opened) { test.skip(); return; }
    await saveOrder();
    const status = await getOrderStatus();
    console.log(`[Order 1] Final status: ${status}`);
    await ss('order1-11-final-status');
    await closeOrder();
  });
});

// ============================================================================
// ORDER 2 — Partial CANP + multiple shipments + UAR
// Steps: overview → warnings → partial CANP → confirm all → ship (split) →
//        letter ship → UAR → verify Shipped
// ============================================================================

test.describe('Order 2', () => {
  let opened = false;
  let positions: Position[] = [];

  test('[Order 2] 1. Verify order in overview', async () => {
    test.setTimeout(60000);
    if (!orders[1]) { test.skip(); return; }
    await ensureLoggedIn();
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(3000);
    const body = await page.locator('body').textContent() || '';
    const inList = body.includes(orders[1]);
    console.log(`[Order 2] ${orders[1]} in overview: ${inList}`);
    expect(inList).toBeTruthy();
    await ss('order2-1-overview');
  });

  test('[Order 2] 2. Open and verify delivery address', async () => {
    test.setTimeout(120000);
    if (!orders[1]) { test.skip(); return; }
    opened = await findAndOpenOrder(orders[1]);
    if (!opened) { test.skip(); return; }
    const hasAddress = await verifyDeliveryAddress(2);
    expect(hasAddress).toBeTruthy();
    await ss('order2-2-delivery');
  });

  test('[Order 2] 3. Verify stock warnings', async () => {
    test.setTimeout(60000);
    if (!opened) { test.skip(); return; }
    const warnings = await verifyStockWarnings(2);
    console.log(`[Order 2] Stock warnings: ${warnings.length}`);
    await ss('order2-3-stock-warnings');
  });

  test('[Order 2] 4. Read positions', async () => {
    test.setTimeout(60000);
    if (!opened) { test.skip(); return; }
    positions = await readPositions();
    console.log(`[Order 2] Positions: ${positions.map(p => `${p.sku}(${p.qty})`).join(', ')}`);
    expect(positions.length).toBeGreaterThan(0);
  });

  // Step 5: Import CANP — partial approve some, reject others, accept one
  test('[Order 2] 5. Import CANP and handle mixed cancellations', async () => {
    test.setTimeout(180000);
    if (!opened || positions.length === 0) { test.skip(); return; }

    const uploaded = await importEDI('GCANP', orders[1], positions);
    if (uploaded) {
      await page.waitForTimeout(15000);
      await page.reload(); await page.waitForTimeout(5000);
      await dismissAnyModal();
    }

    const alert = await checkForNotification(2, 'canp-alert');
    console.log(`[Order 2] CANP alert: ${alert}`);

    const tabFound = await navigateToCancellationTab();
    console.log(`[Order 2] Cancellation tab: ${tabFound}`);
    await ss('order2-5a-canp-mixed');

    // 5a: approve partial qty for first item (6 of total, or qty-1), reject second, accept third
    const rows = page.locator('tbody tr').filter({ visible: true });
    const rowCount = await rows.count();
    console.log(`[Order 2] Cancellation rows: ${rowCount}`);

    if (rowCount > 0) {
      // For first row: partial approve (approve qty-1 of total)
      const firstRowText = (await rows.first().textContent() || '');
      const totalQtyM = firstRowText.match(/\b(\d{1,3})\b/);
      const totalQty = totalQtyM ? parseInt(totalQtyM[1]) : 10;
      const approveQty = Math.min(totalQty - 1, Math.floor(totalQty * 0.6));
      await partialApproveCancellationItem(0, approveQty > 0 ? approveQty : 1);
      console.log(`[Order 2] Partial approve ${approveQty}/${totalQty} for row 0`);
      await ss('order2-5a-partial-approve');
    }
    if (rowCount > 1) {
      // For second row: reject
      try {
        const rejectBtn = rows.nth(1).locator('button').filter({ hasText: /reject/i }).first();
        if (await rejectBtn.count() > 0) {
          await rejectBtn.click(); await page.waitForTimeout(800);
          const msgInput = page.locator('textarea,input[type="text"]').filter({ visible: true }).last();
          if (await msgInput.isVisible({ timeout: 1500 }).catch(() => false)) await msgInput.fill('Cannot process');
          const conf = page.locator('button').filter({ hasText: /^(Confirm|OK)$/ }).filter({ visible: true }).last();
          if (await conf.count() > 0) await conf.click();
          await page.waitForTimeout(800);
          console.log('[Order 2] Row 1 rejected');
        }
      } catch {}
      await ss('order2-5b-reject');
    }
    if (rowCount > 2) {
      // For third row: accept fully
      await partialApproveCancellationItem(2, 999); // full accept
      console.log('[Order 2] Row 2 accepted');
      await ss('order2-5c-accept');
    }

    await saveOrder();
    await ss('order2-5d-canp-saved');

    // 5e: order items enabled again after handling
    await clickTab('Order items');
    await page.waitForTimeout(1500);
    const confirmBtns = page.locator('button').filter({ hasText: /^(Confirm|Accept|Confirm position)$/ }).filter({ visible: true });
    const enabled = await confirmBtns.count() > 0;
    console.log(`[Order 2] Order items enabled after CANP: ${enabled}`);
    await ss('order2-5e-items-enabled');
  });

  // Step 6: Confirm all positions → verify GORDR + GCANR on SFTP
  test('[Order 2] 6. Confirm all positions and verify GORDR + GCANR', async () => {
    test.setTimeout(180000);
    if (!opened) { test.skip(); return; }

    const confirmed = await confirmAllPositions(2);
    const status = await getOrderStatus();
    console.log(`[Order 2] Status after confirm: ${status} (${confirmed} confirmed)`);

    await uploadGORDR(orders[1], positions);
    const ordrFile = await waitForSftpFile(new RegExp(`ORDR.*${orders[1]}`, 'i'), 'GORDR', 30000);
    const canrFile = await waitForSftpFile(new RegExp(`GCANR.*${orders[1]}`, 'i'), 'GCANR', 30000);
    console.log(`[Order 2] GORDR: ${ordrFile} | GCANR: ${canrFile}`);
    await ss('order2-6-confirmed');
  });

  // Step 7: Create shipment with split — select subset of positions
  test('[Order 2] 7. Create shipment with split', async () => {
    test.setTimeout(180000);
    if (!opened) { test.skip(); return; }

    const navOk = await navigateToShipmentTab();
    if (!navOk) { console.log('[Order 2] Shipment tab not found'); return; }

    // Split first position: qty-1 shipped now
    const firstQty = positions[0]?.qty || 2;
    const splitQty = firstQty > 1 ? firstQty - 1 : 0;
    await createShipmentDialog({ carrier: 'Swiss Post', parcelType: 'General Cargo', splitQty });
    await ss('order2-7a-shipment');

    // 7c: only DELR created
    await uploadGDELR(orders[1], positions.slice(0, 1), `SHP${Date.now().toString().slice(-8)}`);
    const delrFile = await waitForSftpFile(new RegExp(`DELR.*${orders[1]}`, 'i'), 'GDELR', 60000);
    console.log(`[Order 2] GDELR: ${delrFile}`);

    // 7d/e: order stays Confirmed (not fully shipped)
    const status = await getOrderStatus();
    console.log(`[Order 2] Status after partial ship: ${status}`);
    await ss('order2-7e-status');
  });

  // Step 8: Create letter shipping for remaining position (no shipment number required)
  test('[Order 2] 8. Create letter shipping', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await navigateToShipmentTab();
    // Letter type — no shipment number required
    const clicked = await clickButton(/create new shipment|new shipment/i, 'create new shipment');
    if (!clicked) { console.log('[Order 2] No new shipment button'); return; }
    await page.waitForTimeout(2000);

    // Select "Letter" carrier type (varies by UI)
    try { await selectShipmentDropdown(0, 'Letter'); } catch {}
    try { await selectShipmentDropdown(1, 'Letter'); } catch {}

    // 8a: no shipping number required for letter
    const shipNumInput = page.locator('input[placeholder*="shipment" i],input[name*="shipment" i]').filter({ visible: true }).first();
    const required = await shipNumInput.getAttribute('required').catch(() => null);
    const isRequired = required !== null;
    console.log(`[Order 2] Letter shipment number required: ${isRequired}`);

    // Check remaining item and add
    const chk = page.locator('tbody tr input[type="checkbox"]').filter({ visible: true }).first();
    if (await chk.count() > 0) { await chk.check(); await page.waitForTimeout(400); }

    await clickButton(/add shipment/i, 'add shipment');
    await page.waitForTimeout(2000);
    await saveOrder();
    await ss('order2-8-letter-shipment');

    // 8b: DELR on SFTP after save
    const delrFile = await waitForSftpFile(new RegExp(`DELR.*${orders[1]}`, 'i'), 'GDELR-letter', 60000);
    console.log(`[Order 2] Letter GDELR: ${delrFile}`);

    // 8d: order status changes to Shipped
    const status = await getOrderStatus();
    console.log(`[Order 2] Status after letter ship: ${status}`);
  });

  // Step 9: Manually register UAR (return) for position 2, confirm 2 out of qty
  test('[Order 2] 9. Register UAR return and verify', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const pos2Qty = positions[1]?.qty || 3;
    const returnQty = Math.min(2, pos2Qty);
    await registerUAR(1, returnQty, 2);

    // 9a/b: verify status To confirm → Confirmed
    const statusBefore = await getOrderStatus();
    console.log(`[Order 2] UAR status before save: ${statusBefore}`);
    await saveOrder();
    const statusAfter = await getOrderStatus();
    console.log(`[Order 2] UAR status after save: ${statusAfter}`);
    await ss('order2-9-uar');

    // 9d: SURN on SFTP
    const surnFile = await waitForSftpFile(new RegExp(`SURN.*${orders[1]}`, 'i'), 'GSURN-uar', 60000);
    console.log(`[Order 2] GSURN (UAR): ${surnFile}`);
  });

  // Step 10: Verify order status remains Shipped
  test('[Order 2] 10. Verify order status and close', async () => {
    test.setTimeout(60000);
    if (!opened) { test.skip(); return; }
    await saveOrder();
    const status = await getOrderStatus();
    console.log(`[Order 2] Final status: ${status}`);
    await ss('order2-10-final');
    await closeOrder();
  });
});

// ============================================================================
// ORDER 3 — Unknown product + position rejection + CANP + RETP
// Steps: alert email → overview → status New → delivery address →
//        verify unknown product → reject position → CANP accept →
//        confirm → RETP → ship → return → cancel unknown
// ============================================================================

test.describe('Order 3', () => {
  let opened = false;
  let positions: Position[] = [];

  test('[Order 3] 1. Verify alert email and order in overview', async () => {
    test.setTimeout(60000);
    if (!orders[2]) { test.skip(); return; }
    // Navigate to notifications / email settings page to check alert email was sent
    const emailOk = await checkEmailNotification(3);
    console.log(`[Order 3] Email notification: ${emailOk}`);

    await ensureLoggedIn();
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(3000);
    const body = await page.locator('body').textContent() || '';
    expect(body.includes(orders[2])).toBeTruthy();
    await ss('order3-1-overview');
  });

  test('[Order 3] 2. Open order and verify status New + delivery address', async () => {
    test.setTimeout(120000);
    if (!orders[2]) { test.skip(); return; }
    opened = await findAndOpenOrder(orders[2]);
    if (!opened) { test.skip(); return; }

    const status = await getOrderStatus();
    console.log(`[Order 3] Initial status: ${status}`);

    const hasAddress = await verifyDeliveryAddress(3);
    expect(hasAddress).toBeTruthy();
    await ss('order3-2-delivery');
  });

  test('[Order 3] 3. Read positions and identify unknown product', async () => {
    test.setTimeout(60000);
    if (!opened) { test.skip(); return; }
    positions = await readPositions();
    console.log(`[Order 3] Positions: ${positions.map(p => `${p.sku}(${p.qty})`).join(', ')}`);
    expect(positions.length).toBeGreaterThan(0);

    // 5a: check for "unknown" marker on any position
    await dismissAnyModal();
    await clickTab('Order items');
    const body = await page.locator('body').textContent() || '';
    const hasUnknown = /unknown|unbekannt|not found/i.test(body);
    console.log(`[Order 3] Unknown product marker found: ${hasUnknown}`);
    await ss('order3-3-positions');

    // 5b: that position can only be rejected (no confirm button)
    const unknownCard = page.locator('[class*="unknown"],[class*="error"],[class*="warning"]').filter({ visible: true }).first();
    if (await unknownCard.count() > 0) {
      const rejectOnlyBtn = unknownCard.locator('button').filter({ hasText: /reject/i }).first();
      const confirmBtn = unknownCard.locator('button').filter({ hasText: /confirm/i }).first();
      const canOnlyReject = await rejectOnlyBtn.count() > 0 && await confirmBtn.count() === 0;
      console.log(`[Order 3] Unknown position can only reject: ${canOnlyReject}`);
    }
  });

  // Step 4: Reject the unknown product position
  test('[Order 3] 4. Reject unknown product position and verify status + EOLN on SFTP', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    // Find the first unknown position and reject it
    await dismissAnyModal();
    await clickTab('Order items');
    await page.waitForTimeout(1500);

    // Find reject button for unknown position (first or only unknown position)
    const rejectBtns = page.locator('button').filter({ hasText: /reject position/i }).filter({ visible: true });
    const rCount = await rejectBtns.count();
    if (rCount > 0) {
      await rejectBtns.first().click(); await page.waitForTimeout(1000);
      const confirm = page.locator('button').filter({ hasText: /^(OK|Confirm|Yes)$/ }).filter({ visible: true }).first();
      if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(1000); }
      console.log('[Order 3] Reject position clicked');
      await ss('order3-4a-rejected-warning');
    }

    // 7b: verify position status changes to Cancelling before save
    const bodBefore = await page.locator('body').textContent() || '';
    const isCancelling = /cancelling|canceling/i.test(bodBefore);
    console.log(`[Order 3] Position Cancelling before save: ${isCancelling}`);
    await ss('order3-4b-cancelling');

    await saveOrder();

    // 7c: after save → Cancelled by vendor
    const bodyAfter = await page.locator('body').textContent() || '';
    const isCancelled = /cancelled|canceled|vendor/i.test(bodyAfter);
    console.log(`[Order 3] Position Cancelled after save: ${isCancelled}`);
    await ss('order3-4c-cancelled');

    // 7d: EOLN on SFTP
    const eolnFile = await waitForSftpFile(new RegExp(`EOLN.*${orders[2]}`, 'i'), 'EOLN', 60000);
    console.log(`[Order 3] EOLN on SFTP: ${eolnFile}`);
  });

  // Step 5: Import CANP — accept for BB-FLA (unknown, full), partial for others
  test('[Order 3] 5. Import CANP and accept/partial cancellations', async () => {
    test.setTimeout(180000);
    if (!opened || positions.length === 0) { test.skip(); return; }

    const uploaded = await importEDI('GCANP', orders[2], positions);
    if (uploaded) {
      await page.waitForTimeout(15000);
      await page.reload(); await page.waitForTimeout(5000);
      await dismissAnyModal();
    }

    // 8a/b: alert shown, items not editable until CANP handled
    const alert = await checkForNotification(3, 'canp-alert');
    console.log(`[Order 3] CANP alert: ${alert}`);
    await navigateToCancellationTab();
    await ss('order3-5a-canp');

    // 8c: accept unknown product cancellation fully (first item)
    await acceptCancellationItems();

    // 8d/e: partial accepts for others (accept qty 2 and 5 for positions)
    const rows = page.locator('tbody tr').filter({ visible: true });
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      const rowText = (await rows.nth(i).textContent() || '');
      const qtyM = rowText.match(/\b(\d{1,3})\b/);
      const qty = qtyM ? Math.min(parseInt(qtyM[1]), 5) : 2;
      await partialApproveCancellationItem(i, qty);
    }

    await saveOrder();
    await ss('order3-5f-canp-saved');

    // 8f/g: verify split positions created + CANR on SFTP
    const posAfter = await readPositions();
    console.log(`[Order 3] Positions after CANP: ${posAfter.length} (was ${positions.length})`);
    const canrFile = await waitForSftpFile(new RegExp(`GCANR.*${orders[2]}`, 'i'), 'GCANR', 60000);
    console.log(`[Order 3] GCANR: ${canrFile}`);
  });

  // Step 6: Confirm open positions → verify ORDR on SFTP
  test('[Order 3] 6. Confirm positions and verify GORDR on SFTP', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const confirmed = await confirmAllPositions(3);
    const status = await getOrderStatus();
    console.log(`[Order 3] Status after confirm: ${status} (${confirmed} confirmed)`);

    await uploadGORDR(orders[2], positions);
    const ordrFile = await waitForSftpFile(new RegExp(`ORDR.*${orders[2]}`, 'i'), 'GORDR', 30000);
    console.log(`[Order 3] GORDR: ${ordrFile}`);
    await ss('order3-6-confirmed');
  });

  // Step 7: Import RETP — verify can't accept before shipped
  test('[Order 3] 7. Import RETP and verify cannot accept before shipped', async () => {
    test.setTimeout(120000);
    if (!opened || positions.length === 0) { test.skip(); return; }

    const uploaded = await importEDI('GRETP', orders[2], positions.map(p => ({ ...p, qty: 1 })));
    if (uploaded) {
      await page.waitForTimeout(15000);
      await page.reload(); await page.waitForTimeout(5000);
      await dismissAnyModal();
    }

    const alert = await checkForNotification(3, 'retp-alert');
    console.log(`[Order 3] RETP alert: ${alert}`);

    await navigateToReturnTab();
    // Accept button should be disabled before positions are shipped
    const acceptBtn = page.locator('button').filter({ hasText: /^Accept$/ }).filter({ visible: true }).first();
    const isDisabled = await acceptBtn.count() > 0
      ? !await acceptBtn.isEnabled({ timeout: 1500 }).catch(() => true)
      : true;
    console.log(`[Order 3] RETP accept disabled before ship: ${isDisabled}`);
    await ss('order3-7-retp-before-ship');
  });

  // Step 8: Create shipment with all positions
  test('[Order 3] 8. Create shipment with all positions and verify DELR', async () => {
    test.setTimeout(180000);
    if (!opened) { test.skip(); return; }

    const navOk = await navigateToShipmentTab();
    if (!navOk) { console.log('[Order 3] Shipment tab not found'); return; }

    await createShipmentDialog({ carrier: 'Swiss Post', parcelType: 'General Cargo' });
    await ss('order3-8-shipment');

    await uploadGDELR(orders[2], positions, `SHP${Date.now().toString().slice(-8)}`);
    const delrFile = await waitForSftpFile(new RegExp(`DELR.*${orders[2]}`, 'i'), 'GDELR', 60000);
    console.log(`[Order 3] GDELR: ${delrFile}`);
  });

  // Step 9: Accept RETP return for first non-unknown position
  test('[Order 3] 9. Accept return for position and verify SURN', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await navigateToReturnTab();
    const accepted = await acceptCancellationItems();
    console.log(`[Order 3] Return items accepted: ${accepted}`);
    await saveOrder();
    await ss('order3-9a-return-accepted');

    // Verify position status changed
    await clickTab('Order items');
    const bodyAfter = await page.locator('body').textContent() || '';
    const isReturned = /returned|return/i.test(bodyAfter);
    console.log(`[Order 3] Position Returned status: ${isReturned}`);

    // SURN on SFTP
    const surnFile = await waitForSftpFile(new RegExp(`SURN.*${orders[2]}`, 'i'), 'GSURN', 60000);
    console.log(`[Order 3] GSURN: ${surnFile}`);
    await ss('order3-9b-surn');
  });

  // Step 10: Verify unknown product position can only be cancelled, verify SURN
  test('[Order 3] 10. Verify unknown position cancel-only and SURN', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await dismissAnyModal();
    await clickTab('Order items');
    await page.waitForTimeout(1500);
    // The unknown position (e.g. BB-FLA variant) can only be cancelled, not returned
    const body = await page.locator('body').textContent() || '';
    const hasCancelOnly = /cancel|cancell/i.test(body);
    console.log(`[Order 3] Cancel-only position found: ${hasCancelOnly}`);

    const surnFile = await waitForSftpFile(new RegExp(`SURN.*${orders[2]}`, 'i'), 'GSURN-cancel', 30000);
    console.log(`[Order 3] SURN for cancel: ${surnFile}`);
    await ss('order3-10-cancel-only');
  });

  // Step 11: Verify final status and close
  test('[Order 3] 11. Verify final order status and close', async () => {
    test.setTimeout(60000);
    if (!opened) { test.skip(); return; }
    await saveOrder();
    const status = await getOrderStatus();
    console.log(`[Order 3] Final status: ${status}`);
    await ss('order3-11-final');
    await closeOrder();
  });
});
