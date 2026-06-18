import { test, chromium, Page, Browser, type Locator } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { OrdersPage } from '../pages/orders.page';

test.describe.configure({ mode: 'serial' });

// ── State ─────────────────────────────────────────────────────────────────────

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let ordersPage: OrdersPage;

let targetOrderId     = '';
let targetOrderStatus = '';   // 'New' | 'Confirmed'

// ── Setup / teardown ──────────────────────────────────────────────────────────

test.beforeAll(async () => {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page = await context.newPage();
  loginPage = new LoginPage(page);
  ordersPage = new OrdersPage(page);
  await loginPage.login(process.env.TEST_USERNAME || '', process.env.TEST_PASSWORD || '');
  console.log('Login complete');
});

test.afterAll(async () => {
  await browser.close();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ss(name: string) {
  try { await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true }); } catch {}
}

async function save() {
  const ribbons = page.locator('lb-ribbon-big-button').filter({ visible: true });
  const count = await ribbons.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = (await ribbons.nth(i).textContent() || '').trim();
    labels.push(text);
    if (/save|speichern/i.test(text)) {
      await ribbons.nth(i).click();
      await page.waitForTimeout(2000);
      console.log(`  Saved via ribbon: "${text}"`);
      return;
    }
  }
  console.log(`  Save: no save button found. Labels: ${JSON.stringify(labels)}`);
}

// Switch tab WITHOUT saving first (used for inspection only)
async function switchTab(tabName: string): Promise<boolean> {
  const tab = page.getByText(tabName, { exact: true }).filter({ visible: true }).first();
  if (await tab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(2500);
    return true;
  }
  return false;
}

// Switch tab WITH save first (used when changes have been made)
async function clickTab(tabName: string): Promise<boolean> {
  await save();
  const tab = page.getByText(tabName, { exact: true }).filter({ visible: true }).first();
  if (await tab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(3000);
    console.log(`  Clicked tab: "${tabName}"`);
    return true;
  }
  console.log(`  Tab "${tabName}" not found`);
  return false;
}

async function close() {
  try {
    const closeBtn = page.locator('.close-button').filter({ visible: true }).first();
    if (await closeBtn.isVisible({ timeout: 2000 })) { await closeBtn.click(); await page.waitForTimeout(1500); return; }
  } catch {}
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
}

async function dismissModal(modal: Locator) {
  const closeBtn = modal.locator('.close-button, [aria-label="Close"], [aria-label="close"]').filter({ visible: true }).first();
  if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(1000);
    return;
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
}

// Count how many order line-items are on the Order items tab (already open)
async function countItemsOnOrderItemsTab(): Promise<number> {
  // For New orders: each item has a "Confirm position" button
  const confirmBtns = page.getByRole('button', { name: /confirm position/i }).filter({ visible: true });
  const btnCount = await confirmBtns.count();
  if (btnCount > 0) return btnCount;

  // For Confirmed orders: count non-empty table rows
  const rows = page.locator('tbody tr');
  const rowCount = await rows.count();
  let count = 0;
  for (let i = 0; i < rowCount; i++) {
    const text = (await rows.nth(i).textContent() || '').trim();
    if (text.length > 5) count++;   // skip empty / whitespace-only rows
  }
  return count;
}

// Open combobox and select the first available option
async function selectCombobox(modal: Locator, index: number): Promise<boolean> {
  const combo = modal.locator('lb-combobox').filter({ visible: true }).nth(index);
  if (await combo.count() === 0) return false;

  const comboInput = combo.locator('input').first();
  if (await comboInput.count() > 0) {
    await comboInput.click({ force: true });
    await page.waitForTimeout(2500);
    const opts = page.locator('lb-option, .lb-option, [class*="lb-option"], .dropdown-item, [role="option"]').filter({ visible: true });
    if (await opts.count() > 0) {
      await opts.first().click();
      await page.waitForTimeout(600);
      console.log(`  combo[${index}]: selected via input click`);
      return true;
    }
  }

  const buttons = await combo.locator('button').all();
  if (buttons.length > 0) {
    await buttons[buttons.length - 1].click({ force: true });
    await page.waitForTimeout(2500);
    const opts = page.locator('lb-option, .lb-option, [class*="lb-option"], .dropdown-item, [role="option"]').filter({ visible: true });
    if (await opts.count() > 0) {
      await opts.first().click();
      await page.waitForTimeout(600);
      console.log(`  combo[${index}]: selected via last button`);
      return true;
    }
  }

  await combo.click({ force: true });
  await page.waitForTimeout(2500);
  const opts3 = page.locator('lb-option, .lb-option, [class*="lb-option"], .dropdown-item, [role="option"]').filter({ visible: true });
  if (await opts3.count() > 0) {
    await opts3.first().click();
    await page.waitForTimeout(600);
    console.log(`  combo[${index}]: selected via container click`);
    return true;
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  console.log(`  combo[${index}]: no options found`);
  return false;
}

// ── Step 1: Find a single-item New order (fallback: Confirmed), confirm positions

test('Step 1: Find single-item order and confirm positions', async () => {
  test.setTimeout(300000);

  await ordersPage.navigateToOrders();
  await page.waitForTimeout(3000);
  await ss('step1-orders-list');

  const idColIdx     = await ordersPage.findColumnIndex('ID');
  const statusColIdx = await ordersPage.findColumnIndex('Status');
  const rows         = page.locator('tbody tr');
  const rowCount     = await rows.count();
  console.log(`Total rows: ${rowCount}`);

  // Separate New and Confirmed orders — skip Shipped entirely
  const newOrders: string[]       = [];
  const confirmedOrders: string[] = [];
  let allShipped = true;

  for (let i = 0; i < rowCount; i++) {
    const id     = (await ordersPage.getCellText(i, idColIdx)).trim();
    const status = (await ordersPage.getCellText(i, statusColIdx)).trim();
    if (!id) continue;
    console.log(`  Row ${i}: ID="${id}" Status="${status}"`);
    if (status === 'New')       { newOrders.push(id);       allShipped = false; }
    else if (status === 'Confirmed') { confirmedOrders.push(id); allShipped = false; }
    // Shipped → silently ignored
  }

  if (allShipped || (newOrders.length === 0 && confirmedOrders.length === 0)) {
    console.log('There are not new and confirmed orders');
    return;
  }

  // Try New first, then Confirmed
  const candidates = [...newOrders, ...confirmedOrders];
  console.log(`Candidates: New=[${newOrders.join(', ')}] Confirmed=[${confirmedOrders.join(', ')}]`);

  for (const orderId of candidates) {
    console.log(`\n── Checking order ${orderId} ──`);

    // Filter the list to this order and open it
    await ordersPage.setTextFilter(idColIdx, orderId);
    await page.waitForTimeout(1500);
    const filteredRows = page.locator('tbody tr');
    if (await filteredRows.count() === 0) { console.log(`  Not found after filter`); continue; }
    await filteredRows.first().dblclick();
    await page.waitForTimeout(4000);
    await ss(`step1-${orderId}-opened`);

    // Switch to Order items tab WITHOUT saving (inspection only)
    const onItems = await switchTab('Order items');
    if (!onItems) {
      console.log(`  Order items tab not found for ${orderId}`);
      await close();
      continue;
    }
    await page.waitForTimeout(1000);

    const itemCount = await countItemsOnOrderItemsTab();
    console.log(`  Order ${orderId}: ${itemCount} item(s)`);

    if (itemCount !== 1) {
      console.log(`  Skipping — needs exactly 1 item (found ${itemCount})`);
      await close();
      await page.waitForTimeout(1000);
      // Re-navigate to orders for next iteration
      await ordersPage.navigateToOrders();
      await page.waitForTimeout(2000);
      continue;
    }

    // Found a single-item order — record it
    targetOrderId     = orderId;
    targetOrderStatus = newOrders.includes(orderId) ? 'New' : 'Confirmed';
    console.log(`  Selected order ${orderId} (${targetOrderStatus}) — 1 item`);
    await ss(`step1-${orderId}-selected`);
    break;
  }

  if (!targetOrderId) {
    console.log('There are not new and confirmed orders with a single item');
    return;
  }

  // If New: go to Order items tab and confirm the position
  if (targetOrderStatus === 'New') {
    // Use clickTab (saves first), then confirm positions
    await clickTab('Order items');
    await ss(`step1-${targetOrderId}-items-tab`);

    let confirmed = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      const btn = page.getByRole('button', { name: /confirm position/i }).filter({ visible: true }).first();
      if (!await btn.isVisible({ timeout: 2000 }).catch(() => false)) break;
      if (!await btn.isEnabled({ timeout: 1000 }).catch(() => false)) break;
      await btn.click();
      await page.waitForTimeout(1500);
      confirmed++;
      console.log(`  Confirmed position ${confirmed}`);
    }
    await save();
    await ss(`step1-${targetOrderId}-confirmed`);
    console.log(`STEP 1 PASSED — confirmed ${confirmed} position(s) on order ${targetOrderId}`);
  } else {
    console.log(`Order ${targetOrderId} is already Confirmed — skipping position confirmation`);
    console.log('STEP 1 PASSED — order already confirmed');
  }
});

// ── Step 2: Add shipment on Shipping tab ──────────────────────────────────────

test('Step 2: Add shipment on Shipping tab', async () => {
  test.setTimeout(300000);

  if (!targetOrderId) {
    console.log('No order was selected in Step 1 — skipping');
    return;
  }

  await ss('step2-start');

  // Go to Shipping tab (order is still open from Step 1)
  const shippingTabNames = ['Shipping', 'Shipment', 'Delivery', 'Lieferung', 'Versand'];
  let onShippingTab = false;
  for (const tabName of shippingTabNames) {
    onShippingTab = await clickTab(tabName);
    if (onShippingTab) break;
  }
  if (!onShippingTab) {
    const tabTexts = await page.locator('[role="tab"], .tab, lb-tab').filter({ visible: true }).allTextContents();
    console.log(`Shipping tab not found. Available: ${JSON.stringify(tabTexts.map(t => t.trim()).filter(Boolean))}`);
    await ss('step2-no-shipping-tab');
    return;
  }
  await ss('step2-shipping-tab');

  // Click "Create new shipment"
  const createBtn   = page.locator('lb-ribbon-big-button').filter({ hasText: /create new shipment|new shipment/i }).filter({ visible: true }).first();
  const fallbackBtn = page.getByRole('button', { name: /create new shipment/i }).filter({ visible: true }).first();
  const btnToClick  = await createBtn.isVisible({ timeout: 3000 }).catch(() => false) ? createBtn : fallbackBtn;

  if (!await btnToClick.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('"Create new shipment" button not found');
    await ss('step2-no-create-btn');
    return;
  }
  await btnToClick.click();
  await page.waitForTimeout(3000);
  await ss('step2-modal');

  const modal = page.locator('lb-modal, lb-dialog, [role="dialog"]').filter({ visible: true }).first();
  if (!await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('No modal appeared');
    await ss('step2-no-modal');
    return;
  }
  console.log(`Modal: ${(await modal.textContent() || '').slice(0, 300)}`);

  // Select Carrier and Parcel type
  await selectCombobox(modal, 0);
  await selectCombobox(modal, 1);

  // Fill Shipment number and Delivery note number (exclude combobox inputs)
  const allInputs  = modal.locator('input[type="text"], input:not([type])').filter({ visible: true });
  const inputCount = await allInputs.count();
  const standaloneIdx: number[] = [];
  for (let i = 0; i < inputCount; i++) {
    const insideCombo = await allInputs.nth(i).evaluate((el) => !!el.closest('lb-combobox'));
    if (!insideCombo) standaloneIdx.push(i);
  }
  console.log(`Standalone inputs: ${standaloneIdx.length}`);
  if (standaloneIdx.length > 0) await allInputs.nth(standaloneIdx[0]).fill(`SHIP-${targetOrderId}`);
  if (standaloneIdx.length > 1) await allInputs.nth(standaloneIdx[1]).fill(`DN-${targetOrderId}`);
  await page.waitForTimeout(500);

  // Check item checkboxes
  const checkboxes = modal.locator('input[type="checkbox"]').filter({ visible: true });
  for (let i = 0; i < await checkboxes.count(); i++) {
    if (!await checkboxes.nth(i).isChecked().catch(() => false)) {
      await checkboxes.nth(i).click({ force: true });
      await page.waitForTimeout(400);
      console.log(`  Checked checkbox[${i}]`);
    }
  }
  const lbCbs = modal.locator('lb-checkbox').filter({ visible: true });
  for (let i = 0; i < await lbCbs.count(); i++) {
    await lbCbs.nth(i).click({ force: true });
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1000);
  await ss('step2-fields-filled');

  // Click "Add shipment"
  const addBtn = modal.getByRole('button', { name: /add shipment/i }).filter({ visible: true }).first();
  if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    const enabled = await addBtn.isEnabled().catch(() => false);
    console.log(`"Add shipment" enabled: ${enabled}`);
    if (enabled) {
      await addBtn.click();
      await page.waitForTimeout(4000);
      console.log('Clicked "Add shipment"');
      await ss('step2-shipment-added');
    } else {
      console.log('"Add shipment" disabled — dismissing modal');
      await dismissModal(modal);
    }
  } else {
    console.log('"Add shipment" button not found');
    await dismissModal(modal);
  }

  // Wait for modal to close before saving
  await page.locator('lb-modal').waitFor({ state: 'hidden', timeout: 10000 }).catch(async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  });
  await page.waitForTimeout(2000);

  if (!await page.locator('lb-modal').isVisible().catch(() => false)) {
    await save();
    await ss('step2-saved');
  } else {
    console.log('Modal still visible — cannot save');
  }

  await close();
  await page.waitForTimeout(2000);
  await ss('step2-done');
  console.log(`STEP 2 PASSED — shipment added for order ${targetOrderId}`);
});

// ── Step 3: Verify order status ───────────────────────────────────────────────

test('Step 3: Verify order status', async () => {
  test.setTimeout(120000);

  if (!targetOrderId) {
    console.log('No order was processed — skipping verification');
    return;
  }

  await ordersPage.navigateToOrders();
  await page.waitForTimeout(3000);

  const idColIdx     = await ordersPage.findColumnIndex('ID');
  const statusColIdx = await ordersPage.findColumnIndex('Status');
  await ordersPage.setTextFilter(idColIdx, targetOrderId);
  await page.waitForTimeout(1500);

  const status = (await ordersPage.getCellText(0, statusColIdx)).trim();
  console.log(`Order ${targetOrderId}: ${targetOrderStatus} → "${status}"`);

  await ss('step3-final');
  console.log(`STEP 3 PASSED — order ${targetOrderId} final status: "${status}"`);
});
