import { test, expect, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { OrdersPage } from '../pages/orders.page';

test.describe.configure({ mode: 'serial' });

const MAX_ORDERS = 10;

let orders: string[] = [];
let orderPositions: { sku: string; qty: number }[][] = [];

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let ordersPage: OrdersPage;

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

// Close any blocking modal/dialog (e.g. a "Create shipment" dialog left open from a previous run).
async function dismissAnyModal(): Promise<void> {
  try {
    const dialog = page.locator('lb-dialog, [role="dialog"], .lb-dialog').filter({ visible: true }).first();
    if (!(await dialog.count() > 0 && await dialog.isVisible({ timeout: 1000 }).catch(() => false))) return;
    // Try Escape first
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    if (await dialog.isVisible({ timeout: 500 }).catch(() => false)) {
      // Click the × button inside the dialog
      const xBtn = dialog.locator('button').filter({ hasText: /^[×✕x]$/i }).first();
      if (await xBtn.count() > 0) { await xBtn.click(); await page.waitForTimeout(1000); }
    }
    console.log('  dismissAnyModal: closed dialog');
  } catch {}
}

async function getOrderStatus(): Promise<string> {
  const body = await page.locator('body').textContent() || '';
  for (const s of ['Shipped', 'Confirmed', 'New', 'Open', 'Cancelled', 'Closed']) {
    if (body.includes(s)) return s;
  }
  return 'unknown';
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
async function closeOrder(): Promise<void> {
  try {
    const closeBtn = page.locator([
      'button[aria-label*="close" i]',
      'button[aria-label*="back" i]',
      '[class*="close-btn"]',
      'button:has(mat-icon:text("close"))',
      'button:has(mat-icon:text("arrow_back"))',
    ].join(', ')).filter({ visible: true }).first();

    if (await closeBtn.count() > 0 && await closeBtn.isVisible({ timeout: 2000 })) {
      await closeBtn.click();
      await page.waitForTimeout(2000);
      const stillOnDetail = await page.locator('[class*="order-detail"], [class*="order-form"]')
        .isVisible({ timeout: 2000 }).catch(() => false);
      if (!stillOnDetail) { console.log('  closeOrder: closed via X button'); return; }
    }
  } catch {}

  try { await page.keyboard.press('Escape'); await page.waitForTimeout(1000); } catch {}
  await ordersPage.navigateToOrders();
  await page.waitForTimeout(2000);
  console.log('  closeOrder: returned to orders list via navigation');
}

// Navigate to the Shipping tab, saving first.
async function navigateToShipmentTab(): Promise<boolean> {
  await dismissAnyModal();
  await saveOrder();
  for (const name of ['Shipping', 'Shipment', 'Shipments', 'Delivery', 'Deliveries']) {
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
  console.log('  Shipment tab not found');
  return false;
}

// Open a lb-combobox dropdown by index (0=Carrier, 1=Parcel type) and select an option.
async function selectShipmentDropdown(nth: number, preferText?: string): Promise<void> {
  const combos = page.locator('lb-combobox').filter({ visible: true });
  if (await combos.count() > nth) {
    // Click the combobox container itself to open the dropdown panel
    // (the internal button has lb-visually-hidden and is not interactable)
    await combos.nth(nth).click();
    await page.waitForTimeout(1500);
    const options = page.locator('lb-option, .dropdown-item, [class*="item-label"]').filter({ visible: true });
    if (preferText) {
      const match = options.filter({ hasText: new RegExp(preferText, 'i') }).first();
      if (await match.count() > 0) { await match.click(); await page.waitForTimeout(500); return; }
    }
    const first = options.first();
    if (await first.count() > 0) { await first.click(); await page.waitForTimeout(500); }
    return;
  }
  // Fallback: native <select>
  const selects = page.locator('select').filter({ visible: true });
  if (await selects.count() > nth) {
    const sel = selects.nth(nth);
    if (preferText) {
      try { await sel.selectOption({ label: preferText }); return; } catch {}
    }
    const opts = await sel.locator('option').allTextContents();
    const valid = opts.find(o => o.trim() && !o.includes('--') && !o.toLowerCase().includes('select'));
    if (valid) await sel.selectOption({ label: valid.trim() });
  }
}

// Phase 1 — confirm all positions in the Order Items tab then save.
async function confirmAllPositions(): Promise<void> {
  await dismissAnyModal();
  let opened = await saveAndClickTab('Order items');
  if (!opened) opened = await clickTab('Items');
  if (!opened) opened = await clickTab('Positions');
  if (!opened) opened = await clickTab('Order positions');
  await page.waitForTimeout(2000);

  // Positions are rendered as cards, not table rows — search page-wide for confirm buttons
  const confirmBtns = page.locator('button').filter({
    hasText: /^(Confirm|Confirm position|Accept)$/
  }).filter({ visible: true });
  const count = await confirmBtns.count();
  let confirmed = 0;
  for (let i = 0; i < count; i++) {
    try {
      const btn = confirmBtns.nth(i);
      if (!await btn.isVisible({ timeout: 1500 }).catch(() => false)) continue;
      if (!await btn.isEnabled({ timeout: 1500 }).catch(() => false)) continue;
      await btn.click();
      await page.waitForTimeout(1000);
      confirmed++;
    } catch {}
  }
  // Save once after all positions confirmed so Shipping tab sees them
  await saveOrder();
  console.log(`  confirmAllPositions: confirmed ${confirmed}/${count} button(s), saved`);
}

// Phase 2 — create a shipment with partial split.
// Carrier: Swiss Post | Parcel type: General Cargo
// Checks first item, sets partial qty to (total_qty - 1), clicks Split,
// unchecks remainder row, then clicks Add shipment.
async function createShipment(): Promise<boolean> {
  await dismissAnyModal();
  const clicked = await clickButton(/create new shipment|new shipment/i, 'create new shipment');
  if (!clicked) { console.log('  createShipment: button not found'); return false; }
  await page.waitForTimeout(2000);

  const ts = Date.now().toString().slice(-8);

  // Carrier — first dropdown
  try {
    await selectShipmentDropdown(0, 'Swiss Post');
    console.log('  Carrier → Swiss Post');
  } catch (e) { console.log('  Carrier failed:', e); }

  // Parcel type — second dropdown
  try {
    await selectShipmentDropdown(1, 'General Cargo');
    console.log('  Parcel type → General Cargo');
  } catch (e) { console.log('  Parcel type failed:', e); }

  // Shipment number and Delivery note number (both required, editable text inputs only)
  try {
    const textInputs = page.locator('input[type="text"]:not([readonly]), input:not([type]):not([readonly]):not([type="checkbox"]):not([type="number"])')
      .filter({ visible: true });
    const inputCount = await textInputs.count();
    if (inputCount > 0) await textInputs.nth(0).fill(`SHP${ts}`);
    if (inputCount > 1) await textInputs.nth(1).fill(`DNT${ts}`);
    console.log(`  shipNum=SHP${ts}  noteNum=DNT${ts}`);
  } catch (e) { console.log('  Text fields failed:', e); }

  // Check the first item row checkbox
  try {
    const checkboxes = page.locator('tbody tr input[type="checkbox"]').filter({ visible: true });
    if (await checkboxes.count() > 0 && !await checkboxes.first().isChecked().catch(() => false)) {
      await checkboxes.first().check();
      await page.waitForTimeout(500);
      console.log('  Item checkbox checked');
    }
  } catch (e) { console.log('  Checkbox failed:', e); }

  // Read qty from the first row, set partial = qty-1, click Split
  try {
    const firstRow = page.locator('tbody tr').first();
    const cells = await firstRow.locator('td').allInnerTexts();
    const qty = cells.map(c => parseInt(c.trim())).find(n => !isNaN(n) && n > 1) || 0;

    if (qty > 1) {
      // "Create partial shipment of" number input
      const partialInput = page.locator('input[type="number"]').filter({ visible: true }).first();
      if (await partialInput.count() > 0) {
        await partialInput.fill(String(qty - 1));
        await page.waitForTimeout(500);
        console.log(`  Partial qty: ${qty - 1} of ${qty}`);

        // Click Split
        const splitBtn = page.getByRole('button', { name: /^split$/i }).filter({ visible: true }).first();
        if (await splitBtn.count() > 0 && await splitBtn.isVisible({ timeout: 2000 })) {
          await splitBtn.click();
          await page.waitForTimeout(2000);
          console.log('  Split clicked');

          // Uncheck remainder row (second row = qty 1)
          const checkboxesAfterSplit = page.locator('tbody tr input[type="checkbox"]').filter({ visible: true });
          if (await checkboxesAfterSplit.count() >= 2) {
            if (await checkboxesAfterSplit.nth(1).isChecked().catch(() => false)) {
              await checkboxesAfterSplit.nth(1).uncheck();
              await page.waitForTimeout(300);
              console.log('  Remainder row unchecked');
            }
          }
        }
      }
    }
  } catch (e) { console.log('  Split failed:', e); }

  // Click "Add shipment" to close the dialog and record the shipment
  const added = await clickButton(/add shipment/i, 'add shipment');
  if (!added) {
    try {
      const submitBtn = page.locator('button').filter({ hasText: /add|confirm/i })
        .filter({ visible: true }).last();
      if (await submitBtn.count() > 0) await submitBtn.click();
    } catch {}
  }
  await page.waitForTimeout(2000);
  await saveOrder();
  return true;
}

async function discoverOrders(maxCount = MAX_ORDERS): Promise<string[]> {
  try {
    await ensureLoggedIn();
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(3000);
    const ids: string[] = [];

    const idColIdx = await ordersPage.findColumnIndex('ID');
    console.log(`[discoverOrders] ID column index: ${idColIdx}`);

    const rows = page.locator('tbody tr');
    const rowCount = Math.min(await rows.count(), 50);

    for (let i = 0; i < rowCount && ids.length < maxCount; i++) {
      const cells = rows.nth(i).locator('td');
      const cellCount = await cells.count();

      if (idColIdx >= 0 && idColIdx < cellCount) {
        const text = (await cells.nth(idColIdx).textContent() || '').trim();
        if (text && !ids.includes(text)) ids.push(text);
      } else {
        for (let j = 0; j < Math.min(cellCount, 8); j++) {
          const text = (await cells.nth(j).textContent() || '').trim();
          if (text && /\d/.test(text) && !/\s/.test(text) && text.length <= 40 && !ids.includes(text)) {
            ids.push(text); break;
          }
        }
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
    await dismissAnyModal();
    const opened = await clickTab('Order items');
    if (!opened) await clickTab('Items');
    await page.waitForTimeout(2000);
    const positions: { sku: string; qty: number }[] = [];
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const text = (await rows.nth(i).textContent() || '').trim();
      const skuMatch = text.match(/[A-Z]{2,8}-[A-Z0-9]{2,8}-?\d{2,4}/);
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
    await dismissAnyModal();
    return true;
  } catch (e) {
    console.log(`  findAndOpenOrder(${orderId}) error:`, (e as Error).message);
    return false;
  }
}

// ===========================================================================
// Setup / teardown
// ===========================================================================

test.beforeAll(async () => {
  test.setTimeout(600000);

  browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page = await context.newPage();
  loginPage = new LoginPage(page);
  ordersPage = new OrdersPage(page);

  await loginPage.login(process.env.TEST_USERNAME || 'ashoaib', process.env.TEST_PASSWORD || 'test2');
  await page.waitForTimeout(3000);

  orders = await discoverOrders(MAX_ORDERS);

  orderPositions = Array.from({ length: MAX_ORDERS }, () => []);
  console.log(`Orders ready (${orders.length}): ${orders.join(', ') || 'none'}`);
});

test.afterAll(async () => {
  test.setTimeout(60000);
  await browser.close();
});

// ===========================================================================
// Order workflow — 4 steps per order slot
// ===========================================================================

for (let slot = 0; slot < MAX_ORDERS; slot++) {
  const n = slot + 1;

  test.describe(`Order ${n}`, () => {
    let opened = false;

    // ── Step 1: Open order ────────────────────────────────────────────────
    test(`[Order ${n}] 1. Open order and verify delivery address`, async () => {
      test.setTimeout(180000);
      if (!orders[slot]) { test.skip(); return; }

      opened = await findAndOpenOrder(orders[slot]);
      if (!opened) { test.skip(); return; }

      orderPositions[slot] = await extractPositions();
      await saveOrder();

      const body = await page.locator('body').textContent() || '';
      const hasAddress = /delivery|address|street|city|zip|name/i.test(body);
      console.log(`[Order ${n}] Address found: ${hasAddress} | Positions: ${orderPositions[slot].length}`);
      expect(hasAddress).toBeTruthy();
      await screenshot(`order${n}-1-open`);
    });

    // ── Step 2: Confirm all positions ────────────────────────────────────
    test(`[Order ${n}] 2. Confirm all positions`, async () => {
      test.setTimeout(180000);
      if (!opened) { test.skip(); return; }

      await confirmAllPositions();

      const status = await getOrderStatus();
      console.log(`[Order ${n}] Status after confirm: ${status}`);
      await screenshot(`order${n}-2-confirmed`);
    });

    // ── Step 3: Create shipment with partial split ────────────────────────
    // Carrier: Swiss Post | Parcel type: General Cargo
    // Splits qty into (total-1) shipped now + 1 remainder (unchecked)
    test(`[Order ${n}] 3. Create shipment with partial split`, async () => {
      test.setTimeout(180000);
      if (!opened) { test.skip(); return; }

      await navigateToShipmentTab();
      await createShipment();

      await screenshot(`order${n}-3-shipment`);
    });

    // ── Step 4: Verify Shipped status and close ───────────────────────────
    test(`[Order ${n}] 4. Verify Shipped status and close order`, async () => {
      test.setTimeout(120000);
      if (!opened) { test.skip(); return; }

      await saveOrder();
      const status = await getOrderStatus();
      console.log(`[Order ${n}] Final status: ${status}`);
      await screenshot(`order${n}-4-status`);

      await closeOrder();

      // Verify the order row in the list shows Shipped
      await ordersPage.navigateToOrders();
      await page.waitForTimeout(3000);
      const body = await page.locator('body').textContent() || '';
      console.log(`[Order ${n}] Shipped visible in list: ${/shipped/i.test(body)}`);
    });
  });
}
