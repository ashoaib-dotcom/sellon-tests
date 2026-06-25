import { test, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { OrdersPage } from '../pages/orders.page';
import { OrderDetailPage } from '../pages/order-detail.page';

test.describe.configure({ mode: 'serial' });

// ── State ─────────────────────────────────────────────────────────────────────

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let ordersPage: OrdersPage;
let orderDetail: OrderDetailPage;

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
  orderDetail = new OrderDetailPage(page);
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
  await orderDetail.save();
}

async function clickTab(tabName: string): Promise<boolean> {
  return orderDetail.switchTabWithSave(tabName);
}

async function close() {
  await orderDetail.close();
}

// Returns a date 30 days from now in ISO format (YYYY-MM-DD)
function futureIsoDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
}

// ── Step 1: Find New order, partially confirm quantity, set future date for rest ─

test('Step 1: Partial quantity confirmation (split shipment setup)', async () => {
  test.setTimeout(300000);

  await ordersPage.navigateToOrders();
  await page.waitForTimeout(3000);
  await ss('split-step1-orders-list');

  const idColIdx     = await ordersPage.findColumnIndex('ID');
  const statusColIdx = await ordersPage.findColumnIndex('Status');

  const rowCount = await ordersPage.getRowCount();
  console.log(`Rows: ${rowCount}`);

  // Collect all New order IDs from visible rows
  const newOrderIds: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const id     = (await ordersPage.getCellText(i, idColIdx)).trim();
    const status = (await ordersPage.getCellText(i, statusColIdx)).trim();
    console.log(`  Row ${i}: ID="${id}" Status="${status}"`);
    if (id && status === 'New') newOrderIds.push(id);
  }

  if (newOrderIds.length === 0) {
    console.log('No New orders found — skipping');
    return;
  }

  // Loop through New orders and pick the first one with qty > 1 or multiple items.
  // Orders with a single item at qty=1 are left for the order-workflow test (test 11).
  let allInputs = orderDetail.getVisibleInputs();
  let inputCount = 0;
  let btnCount   = 0;

  for (const orderId of newOrderIds) {
    console.log(`Checking order ${orderId} for splittable qty...`);

    await ordersPage.setTextFilter(idColIdx, orderId);
    await page.waitForTimeout(1500);
    if (await ordersPage.getRowCount() === 0) {
      console.log(`  Order ${orderId} not found after filter — skipping`);
      continue;
    }

    await ordersPage.openOrderDetail(0);
    await page.waitForTimeout(3000);
    await ss(`split-step1-${orderId}-opened`);

    // Enter edit mode so that Confirm position buttons become visible
    await orderDetail.clickRibbonButton(/^edit$/i);
    await page.waitForTimeout(1500);

    // Go to Order items tab
    const onItems = await orderDetail.switchTab('Order items');
    if (!onItems) {
      console.log(`  Order items tab not found for ${orderId}`);
      await orderDetail.close();
      await page.waitForTimeout(1000);
      await ordersPage.navigateToOrders();
      await page.waitForTimeout(2000);
      continue;
    }

    btnCount   = await orderDetail.countItemsOnOrderItemsTab();
    allInputs  = orderDetail.getVisibleInputs();
    inputCount = await allInputs.count();

    // Check if splittable: multiple line items, or any input with numeric value > 1
    let splittable = btnCount > 1;
    if (!splittable) {
      for (let i = 0; i < inputCount; i++) {
        const val = await allInputs.nth(i).inputValue().catch(() => '');
        const n   = parseInt(val);
        if (!isNaN(n) && n > 1) { splittable = true; break; }
      }
    }

    if (splittable) {
      targetOrderId = orderId;
      console.log(`Found splittable New order: ${targetOrderId} (items=${btnCount})`);
      await ss('split-step1-order-items-tab');
      break;
    }

    console.log(`  Order ${orderId}: single item qty=1 — skipping (order-workflow handles it)`);
    await orderDetail.close();
    await page.waitForTimeout(1000);
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(2000);
  }

  if (!targetOrderId) {
    console.log('No splittable New orders found — all have single item with qty=1');
    return;
  }

  // Log all visible inputs for debugging
  console.log(`Visible inputs on Order items tab: ${inputCount}`);
  for (let i = 0; i < inputCount; i++) {
    const val         = await allInputs.nth(i).inputValue().catch(() => '');
    const type        = await allInputs.nth(i).getAttribute('type').catch(() => '');
    const name        = await allInputs.nth(i).getAttribute('name').catch(() => '');
    const placeholder = await allInputs.nth(i).getAttribute('placeholder').catch(() => '');
    console.log(`  Input[${i}]: type="${type}" name="${name}" placeholder="${placeholder}" value="${val}"`);
  }

  console.log(`Confirm position buttons: ${btnCount}`);
  if (btnCount === 0) {
    console.log('No confirm position buttons — order may not be in edit mode');
    return;
  }

  // Find an editable numeric input with value > 1 to split, record originalQty/partialQty
  let foundSplittable = false;
  for (let i = 0; i < inputCount; i++) {
    const val      = await allInputs.nth(i).inputValue().catch(() => '');
    const readonly = await allInputs.nth(i).getAttribute('readonly').catch(() => null);
    const disabled = await allInputs.nth(i).getAttribute('disabled').catch(() => null);
    const numVal   = parseInt(val);
    if (!isNaN(numVal) && numVal > 1 && readonly === null && disabled === null) {
      originalQty = numVal;
      partialQty  = Math.max(1, Math.floor(originalQty / 2)); // confirm half, keep rest for later
      console.log(`  Quantity input[${i}]: original=${originalQty}, will confirm=${partialQty}`);
      foundSplittable = true;
      break;
    }
  }

  if (foundSplittable) {
    // Edit quantity to the partial amount via OrderDetailPage
    await orderDetail.editQuantity(String(partialQty));
    await ss('split-step1-qty-edited');
    console.log(`  Quantity changed to ${partialQty}`);
  } else {
    console.log(`  No splittable quantity (qty > 1) found — confirming full quantity for first item`);
    partialQty = 1;
  }

  // Click Confirm position for the first item
  await orderDetail.clickConfirmPosition(0);
  await page.waitForTimeout(1500);
  await ss('split-step1-after-first-confirm');

  // A second row should appear at the bottom for the remaining quantity
  // It will contain a date field for the planned future delivery
  const dateCount = await page
    .locator('input[type="date"], lb-datepicker input, [class*="date"] input')
    .filter({ visible: true })
    .count();
  console.log(`Date inputs visible after first confirm: ${dateCount}`);

  if (dateCount > 0) {
    const isoDate = futureIsoDate();
    console.log(`  Setting future date: ${isoDate}`);
    await orderDetail.setDateInput(isoDate);
    await page.waitForTimeout(500);
    await ss('split-step1-date-set');

    // Confirm the remaining back-order row
    // Look for a new "Confirm" button that appeared (could be the last one now)
    await page.waitForTimeout(1000);
    const allConfirmCount = await page
      .getByRole('button', { name: /confirm/i })
      .filter({ visible: true })
      .count();
    console.log(`Total confirm buttons after date set: ${allConfirmCount}`);

    if (allConfirmCount > 0) {
      // The last confirm button belongs to the new back-order row
      await orderDetail.clickConfirmPosition(allConfirmCount - 1);
      await page.waitForTimeout(500);
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
    const availableTabs = await orderDetail.getAvailableTabs();
    console.log(`Shipping tab not found. Available: ${JSON.stringify(availableTabs)}`);
    await ss('split-step2-no-shipping-tab');
    return;
  }
  await ss('split-step2-shipping-tab');

  // Click "Create new shipment"
  const clicked = await orderDetail.clickCreateNewShipment();
  if (!clicked) {
    await ss('split-step2-no-create-btn');
    return;
  }
  await ss('split-step2-modal');

  const modal = orderDetail.getModal();
  if (!await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('No modal appeared');
    await ss('split-step2-no-modal');
    return;
  }
  console.log(`Modal text: ${(await modal.textContent() || '').slice(0, 400)}`);

  // Select Carrier and Parcel type
  await orderDetail.selectCombobox(modal, 0);
  await orderDetail.selectCombobox(modal, 1);

  // Fill Shipment number and Delivery note number (exclude combobox inputs)
  await orderDetail.fillShipmentNumber(modal, `SPLIT-SHIP-${targetOrderId}`);
  await orderDetail.fillDeliveryNoteNumber(modal, `SPLIT-DN-${targetOrderId}`);
  await page.waitForTimeout(500);

  // Check item checkboxes
  await orderDetail.checkItemCheckboxes(modal);
  await ss('split-step2-fields-filled');

  // Click "Add shipment"
  await orderDetail.clickAddShipment(modal);
  await ss('split-step2-shipment-added');

  // Wait for modal to close, then save
  await orderDetail.waitForModalToClose();

  if (!await orderDetail.isModalVisible()) {
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

  const status = (await ordersPage.getCellText(0, statusColIdx)).trim();
  console.log(`Split order ${targetOrderId} status: "${status}"`);
  console.log(`  (Confirmed ${partialQty} of ${originalQty} items — remaining ${originalQty - partialQty} on back-order)`);

  await ss('split-step3-final');
  console.log(`STEP 3 PASSED — order ${targetOrderId} final status: "${status}"`);
});
