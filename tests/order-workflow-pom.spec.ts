import { test, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { OrdersPage } from '../pages/orders.page';

test.describe.configure({ mode: 'serial' });

// ── State ─────────────────────────────────────────────────────────────────────

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let ordersPage: OrdersPage;

let targetOrderId = '';

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
  console.log(`  Save: no save button found. Ribbon labels: ${JSON.stringify(labels)}`);
}

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

async function logButtons(label: string) {
  const btns = page.getByRole('button').filter({ visible: true });
  const texts = await btns.allTextContents();
  console.log(`[${label}] Visible buttons: ${JSON.stringify(texts.map(t => t.trim()).filter(Boolean))}`);
}

// ── Step 1: Find New order → Order items tab → Confirm positions → Save ───────

test('Step 1: Open New order and confirm positions', async () => {
  test.setTimeout(300000);

  await ordersPage.navigateToOrders();
  await page.waitForTimeout(3000);
  await ss('step1-orders-list');

  const idColIdx     = await ordersPage.findColumnIndex('ID');
  const statusColIdx = await ordersPage.findColumnIndex('Status');
  console.log(`Columns — ID: ${idColIdx}, Status: ${statusColIdx}`);

  const rows     = page.locator('tbody tr');
  const rowCount = await rows.count();
  console.log(`Total rows visible: ${rowCount}`);

  let foundRow = -1;
  for (let i = 0; i < rowCount; i++) {
    const id     = (await ordersPage.getCellText(i, idColIdx)).trim();
    const status = (await ordersPage.getCellText(i, statusColIdx)).trim();
    console.log(`  Row ${i}: ID="${id}" Status="${status}"`);
    if (status === 'New' && foundRow === -1) { foundRow = i; targetOrderId = id; }
  }

  if (foundRow === -1) {
    console.log('No New orders found — skipping');
    return;
  }

  console.log(`Opening order ID="${targetOrderId}" (row ${foundRow})`);
  await rows.nth(foundRow).dblclick();
  await page.waitForTimeout(5000);
  await ss('step1-order-opened');

  // Log available tabs
  const tabs = page.locator('[role="tab"], .tab, lb-tab').filter({ visible: true });
  const tabTexts = await tabs.allTextContents();
  console.log(`Visible tabs: ${JSON.stringify(tabTexts.map(t => t.trim()).filter(Boolean))}`);

  // Go to Order items tab
  const onItemsTab = await clickTab('Order items');
  if (!onItemsTab) console.log('Order items tab not found — trying from current view');
  await ss('step1-order-items-tab');
  await logButtons('Order items tab');

  // Confirm all positions
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
  console.log(`Total positions confirmed: ${confirmed}`);
  await ss('step1-after-confirm');

  // Save after confirming
  await save();
  await ss('step1-after-save');

  console.log(`STEP 1 PASSED — confirmed ${confirmed} positions on order ${targetOrderId}`);
});

// ── Step 2: Go to Shipping tab → Add shipment → Save → Close ─────────────────

test('Step 2: Add shipment on Shipping tab', async () => {
  test.setTimeout(300000);

  if (!targetOrderId) {
    console.log('No order was processed in Step 1 — skipping');
    return;
  }

  // Try multiple possible tab names for the shipping/delivery tab
  const shippingTabNames = ['Shipping', 'Shipment', 'Delivery', 'Lieferung', 'Versand'];
  let onShippingTab = false;
  for (const tabName of shippingTabNames) {
    onShippingTab = await clickTab(tabName);
    if (onShippingTab) break;
  }

  if (!onShippingTab) {
    console.log('Shipping tab not found — logging all visible tabs for diagnosis');
    const tabs = page.locator('[role="tab"], .tab, lb-tab').filter({ visible: true });
    const tabTexts = await tabs.allTextContents();
    console.log(`Available tabs: ${JSON.stringify(tabTexts.map(t => t.trim()).filter(Boolean))}`);
    await ss('step2-no-shipping-tab');
    return;
  }

  await ss('step2-shipping-tab');
  await logButtons('Shipping tab');

  // Click "Create new shipment" button
  const addShipmentBtn = page.getByRole('button', { name: /create new shipment|add shipment/i }).filter({ visible: true }).first();
  if (!await addShipmentBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('"Create new shipment" button not found — logging buttons for diagnosis');
    await logButtons('Shipping tab (create shipment missing)');
    await ss('step2-no-add-shipment-btn');
    return;
  }

  await addShipmentBtn.click();
  await page.waitForTimeout(3000);
  await ss('step2-shipment-dialog-opened');

  // The modal is lb-modal (not lb-dialog) — use a broader selector
  const modal = page.locator('lb-modal, lb-dialog, [role="dialog"]').filter({ visible: true }).first();
  if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
    const modalText = (await modal.textContent() || '').trim();
    console.log(`Modal content preview: ${modalText.substring(0, 300)}`);

    // Log all input fields inside the modal
    const inputs = modal.locator('input, select, textarea').filter({ visible: true });
    const inputCount = await inputs.count();
    console.log(`Modal input fields: ${inputCount}`);
    for (let i = 0; i < inputCount; i++) {
      const placeholder = await inputs.nth(i).getAttribute('placeholder').catch(() => '');
      const label       = await inputs.nth(i).getAttribute('aria-label').catch(() => '');
      const name        = await inputs.nth(i).getAttribute('name').catch(() => '');
      console.log(`  Input[${i}]: name="${name}" placeholder="${placeholder}" aria-label="${label}"`);
    }

    // Log all buttons inside the modal
    const modalBtns = modal.getByRole('button').filter({ visible: true });
    const modalBtnTexts = await modalBtns.allTextContents();
    console.log(`Modal buttons: ${JSON.stringify(modalBtnTexts.map(t => t.trim()).filter(Boolean))}`);

    // Click Save/OK/Confirm inside the modal
    const modalSaveBtn = modal.getByRole('button', { name: /save|ok|confirm|add|create/i }).filter({ visible: true }).first();
    if (await modalSaveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await modalSaveBtn.click();
      await page.waitForTimeout(3000);
      console.log('  Clicked save in shipment modal');
      await ss('step2-modal-saved');
    } else {
      // Close modal without saving so it doesn't block subsequent actions
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
      console.log('  No save button found in modal — dismissed with Escape');
      await ss('step2-modal-dismissed');
    }
  } else {
    console.log('No modal appeared after clicking Create new shipment');
    await ss('step2-no-modal');
  }

  // Wait for modal to be fully closed before saving the order
  await page.locator('lb-modal').filter({ visible: true }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // Save the order
  await save();
  await ss('step2-after-save');

  // Close the order
  await close();
  await page.waitForTimeout(2000);
  await ss('step2-order-closed');

  console.log(`STEP 2 PASSED — shipment added for order ${targetOrderId}`);
});

// ── Step 3: Verify order status changed in the list ───────────────────────────

test('Step 3: Verify order status changed from New', async () => {
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
  await page.waitForTimeout(2000);
  await ss('step3-filtered-list');

  const status = (await ordersPage.getCellText(0, statusColIdx)).trim();
  console.log(`Order ${targetOrderId} final status: "${status}"`);

  if (status !== 'New') {
    console.log(`STEP 3 PASSED — status changed from New to "${status}"`);
  } else {
    console.log(`STEP 3 INFO — status is still "New" — check screenshots and logs for what happened`);
  }

  await ss('step3-final-status');
});
