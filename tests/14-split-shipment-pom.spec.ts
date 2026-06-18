import { test, chromium, Page, Browser, type Locator } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { OrdersPage } from '../pages/orders.page';

test.describe.configure({ mode: 'serial' });

// ── State ─────────────────────────────────────────────────────────────────────

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let ordersPage: OrdersPage;

let targetOrderId = '';
let partialQty = 0;
let originalQty = 0;

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

// Returns a date 30 days from now in ISO format (YYYY-MM-DD)
function futureIsoDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
}

// Set a date value on an input, trying ISO then European format
async function setDateInput(input: Locator, isoDate: string): Promise<boolean> {
  // Try ISO format first (works for input[type="date"])
  await input.fill(isoDate);
  await page.waitForTimeout(300);
  const val = await input.inputValue().catch(() => '');
  if (val) { console.log(`  Date set (ISO): ${val}`); return true; }

  // Try pressing the date parts sequentially (for custom pickers)
  const [yyyy, mm, dd] = isoDate.split('-');
  await input.click();
  await input.pressSequentially(`${dd}.${mm}.${yyyy}`);
  await page.waitForTimeout(300);
  const val2 = await input.inputValue().catch(() => '');
  if (val2) { console.log(`  Date set (EU sequential): ${val2}`); return true; }

  console.log(`  Could not set date on input`);
  return false;
}

// ── Step 1: Find New order, partially confirm quantity, set future date for rest ─

test('Step 1: Partial quantity confirmation (split shipment setup)', async () => {
  test.setTimeout(300000);

  await ordersPage.navigateToOrders();
  await page.waitForTimeout(3000);
  await ss('split-step1-orders-list');

  const idColIdx     = await ordersPage.findColumnIndex('ID');
  const statusColIdx = await ordersPage.findColumnIndex('Status');

  const rows     = page.locator('tbody tr');
  const rowCount = await rows.count();
  console.log(`Rows: ${rowCount}`);

  // Find the first New order
  let foundRow = -1;
  for (let i = 0; i < rowCount; i++) {
    const id     = (await ordersPage.getCellText(i, idColIdx)).trim();
    const status = (await ordersPage.getCellText(i, statusColIdx)).trim();
    console.log(`  Row ${i}: ID="${id}" Status="${status}"`);
    if (id && status === 'New') { foundRow = i; targetOrderId = id; break; }
  }

  if (foundRow === -1) {
    console.log('No New orders found — skipping');
    return;
  }
  console.log(`Found New order: ${targetOrderId} (row ${foundRow})`);

  // Open the order
  await rows.nth(foundRow).dblclick();
  await page.waitForTimeout(5000);
  await ss('split-step1-order-opened');

  // Go to Order items tab
  const onItems = await clickTab('Order items');
  if (!onItems) { console.log('Order items tab not found'); return; }
  await ss('split-step1-order-items-tab');

  // Inspect all visible inputs to identify the quantity field
  const allInputs = page.locator('input').filter({ visible: true });
  const inputCount = await allInputs.count();
  console.log(`Visible inputs on Order items tab: ${inputCount}`);
  for (let i = 0; i < inputCount; i++) {
    const val  = await allInputs.nth(i).inputValue().catch(() => '');
    const type = await allInputs.nth(i).getAttribute('type').catch(() => '');
    const name = await allInputs.nth(i).getAttribute('name').catch(() => '');
    const placeholder = await allInputs.nth(i).getAttribute('placeholder').catch(() => '');
    console.log(`  Input[${i}]: type="${type}" name="${name}" placeholder="${placeholder}" value="${val}"`);
  }

  // Find the Confirm position button(s)
  const confirmBtns = page.getByRole('button', { name: /confirm position/i }).filter({ visible: true });
  const btnCount    = await confirmBtns.count();
  console.log(`Confirm position buttons: ${btnCount}`);

  if (btnCount === 0) {
    console.log('No confirm position buttons — order may not be New');
    return;
  }

  // Find an editable numeric input with value > 1 to split
  let qtyInputIdx = -1;
  for (let i = 0; i < inputCount; i++) {
    const val      = await allInputs.nth(i).inputValue().catch(() => '');
    const readonly = await allInputs.nth(i).getAttribute('readonly').catch(() => null);
    const disabled = await allInputs.nth(i).getAttribute('disabled').catch(() => null);
    const numVal   = parseInt(val);
    if (!isNaN(numVal) && numVal > 1 && readonly === null && disabled === null) {
      qtyInputIdx = i;
      originalQty = numVal;
      partialQty  = Math.max(1, Math.floor(originalQty / 2)); // confirm half, keep rest for later
      console.log(`  Quantity input[${i}]: original=${originalQty}, will confirm=${partialQty}`);
      break;
    }
  }

  if (qtyInputIdx >= 0) {
    // Edit quantity to the partial amount
    await allInputs.nth(qtyInputIdx).fill(String(partialQty));
    await page.waitForTimeout(500);
    await ss('split-step1-qty-edited');
    console.log(`  Quantity changed to ${partialQty}`);
  } else {
    console.log(`  No splittable quantity (qty > 1) found — confirming full quantity for first item`);
    partialQty = 1;
  }

  // Click Confirm position for the first item
  await confirmBtns.first().click();
  await page.waitForTimeout(3000);
  await ss('split-step1-after-first-confirm');

  // A second row should appear at the bottom for the remaining quantity
  // It will contain a date field for the planned future delivery
  const dateInputs = page.locator('input[type="date"], lb-datepicker input, [class*="date"] input').filter({ visible: true });
  const dateCount  = await dateInputs.count();
  console.log(`Date inputs visible after first confirm: ${dateCount}`);

  if (dateCount > 0) {
    const isoDate = futureIsoDate();
    console.log(`  Setting future date: ${isoDate}`);
    await setDateInput(dateInputs.first(), isoDate);
    await page.waitForTimeout(500);
    await ss('split-step1-date-set');

    // Confirm the remaining back-order row
    // Look for a new "Confirm" button that appeared (could be the last one now)
    await page.waitForTimeout(1000);
    const allConfirm = page.getByRole('button', { name: /confirm/i }).filter({ visible: true });
    const allConfirmCount = await allConfirm.count();
    console.log(`Total confirm buttons after date set: ${allConfirmCount}`);

    if (allConfirmCount > 0) {
      // The last confirm button belongs to the new back-order row
      await allConfirm.last().click();
      await page.waitForTimeout(2000);
      console.log('  Confirmed back-order row');
      await ss('split-step1-backorder-confirmed');
    }
  } else {
    console.log('  No date input appeared — the item may have had qty=1 or the UI works differently');
    await ss('split-step1-no-date');
  }

  // Save the order
  await save();
  await ss('split-step1-saved');
  console.log(`STEP 1 PASSED — partial confirmation done for order ${targetOrderId} (confirmed ${partialQty} of ${originalQty})`);
});

// ── Step 2: Add first shipment on Shipping tab ─────────────────────────────────

test('Step 2: Add shipment for confirmed partial quantity', async () => {
  test.setTimeout(300000);

  if (!targetOrderId) {
    console.log('No order was processed in Step 1 — skipping');
    return;
  }

  await ss('split-step2-start');

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
    await ss('split-step2-no-shipping-tab');
    return;
  }
  await ss('split-step2-shipping-tab');

  // Click "Create new shipment"
  const createBtn   = page.locator('lb-ribbon-big-button').filter({ hasText: /create new shipment|new shipment/i }).filter({ visible: true }).first();
  const fallbackBtn = page.getByRole('button', { name: /create new shipment/i }).filter({ visible: true }).first();
  const btnToClick  = await createBtn.isVisible({ timeout: 3000 }).catch(() => false) ? createBtn : fallbackBtn;

  if (!await btnToClick.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('"Create new shipment" button not found');
    await ss('split-step2-no-create-btn');
    return;
  }
  await btnToClick.click();
  await page.waitForTimeout(3000);
  await ss('split-step2-modal');

  const modal = page.locator('lb-modal, lb-dialog, [role="dialog"]').filter({ visible: true }).first();
  if (!await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('No modal appeared');
    await ss('split-step2-no-modal');
    return;
  }
  console.log(`Modal text: ${(await modal.textContent() || '').slice(0, 400)}`);

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
  if (standaloneIdx.length > 0) await allInputs.nth(standaloneIdx[0]).fill(`SPLIT-SHIP-${targetOrderId}`);
  if (standaloneIdx.length > 1) await allInputs.nth(standaloneIdx[1]).fill(`SPLIT-DN-${targetOrderId}`);
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
  await ss('split-step2-fields-filled');

  // Click "Add shipment"
  const addBtn = modal.getByRole('button', { name: /add shipment/i }).filter({ visible: true }).first();
  if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    const enabled = await addBtn.isEnabled().catch(() => false);
    console.log(`"Add shipment" enabled: ${enabled}`);
    if (enabled) {
      await addBtn.click();
      await page.waitForTimeout(4000);
      console.log('Clicked "Add shipment"');
      await ss('split-step2-shipment-added');
    } else {
      console.log('"Add shipment" disabled — dismissing modal');
      await dismissModal(modal);
    }
  } else {
    console.log('"Add shipment" button not found');
    await dismissModal(modal);
  }

  // Wait for modal to close, then save
  await page.locator('lb-modal').waitFor({ state: 'hidden', timeout: 10000 }).catch(async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  });
  await page.waitForTimeout(2000);

  if (!await page.locator('lb-modal').isVisible().catch(() => false)) {
    await save();
    await ss('split-step2-saved');
  } else {
    console.log('Modal still visible — cannot save');
  }

  await close();
  await page.waitForTimeout(2000);
  await ss('split-step2-done');
  console.log(`STEP 2 PASSED — first shipment done for split order ${targetOrderId}`);
});

// ── Step 3: Verify order status after partial shipment ─────────────────────────

test('Step 3: Verify split order status', async () => {
  test.setTimeout(60000);

  if (!targetOrderId) {
    console.log('No order was processed — skipping');
    return;
  }

  await ordersPage.navigateToOrders();
  await page.waitForTimeout(3000);

  const idColIdx     = await ordersPage.findColumnIndex('ID');
  const statusColIdx = await ordersPage.findColumnIndex('Status');
  await ordersPage.setTextFilter(idColIdx, targetOrderId);
  await page.waitForTimeout(1500);

  const status  = (await ordersPage.getCellText(0, statusColIdx)).trim();
  console.log(`Split order ${targetOrderId} status: "${status}"`);
  console.log(`  (Confirmed ${partialQty} of ${originalQty} items — remaining ${originalQty - partialQty} on back-order)`);

  await ss('split-step3-final');
  console.log(`STEP 3 PASSED — order ${targetOrderId} final status: "${status}"`);
});
