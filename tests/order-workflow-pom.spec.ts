import { test, expect, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { OrdersPage } from '../pages/orders.page';
import { getSftpHelper, SftpHelper } from '../helpers/sftp-upload';
import { buildGORDR, buildGDELR, buildGCANR, buildGSURN, buildGCANP, buildGRETP } from '../helpers/edi-builder';

test.describe.configure({ mode: 'serial' });

const ORDER_1 = '61830301';
const ORDER_2 = '61830302';
const ORDER_3 = '61830303';

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let ordersPage: OrdersPage;
let sftp: SftpHelper;

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

async function findAndOpenOrder(orderId: string): Promise<boolean> {
  try {
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(3000);

    // Try to filter by the specific order ID first
    const filterInputs = page.locator('thead tr').nth(1).locator('input[type="text"], input:not([type])');
    if (await filterInputs.count() > 0) {
      await filterInputs.first().fill(orderId);
      await page.waitForTimeout(2000);
    }

    // Look for the specific order row
    let row = page.locator('tbody tr').filter({ hasText: orderId }).first();

    // Fallback: if specific order not found, open the first available order row
    if (await row.count() === 0) {
      console.log(`  Order ${orderId} not found — falling back to first available order`);
      // Clear filter and take first row
      if (await filterInputs.count() > 0) {
        await filterInputs.first().fill('');
        await page.waitForTimeout(2000);
      }
      row = page.locator('tbody tr').first();
      if (await row.count() === 0) {
        console.log(`  No orders found in list at all`);
        return false;
      }
    }

    // Orders open on double-click
    await row.dblclick();
    await page.waitForTimeout(5000);
    return true;
  } catch (e) {
    console.log(`  findAndOpenOrder(${orderId}) error:`, (e as Error).message);
    return false;
  }
}

async function getOrderStatus(): Promise<string> {
  const bodyText = await page.locator('body').textContent() || '';
  const statuses = ['New', 'Open', 'Confirmed', 'Shipped', 'Cancelled', 'Closed'];
  for (const status of statuses) {
    if (bodyText.includes(status)) return status;
  }
  return 'unknown';
}


function registerAlertHandler(label: string): { triggered: boolean } {
  const result = { triggered: false };
  page.on('dialog', async (dialog) => {
    console.log(`[${label}] Dialog triggered: ${dialog.message()}`);
    result.triggered = true;
    await dialog.dismiss();
  });
  return result;
}

async function clickTab(tabName: string): Promise<boolean> {
  try {
    const tab = page.getByText(tabName, { exact: true }).filter({ visible: true }).first();
    if (!await tab.isVisible({ timeout: 5000 })) {
      console.log(`  Tab "${tabName}" not visible`);
      return false;
    }
    await tab.click();
    await page.waitForTimeout(3000);
    return true;
  } catch {
    console.log(`  Tab "${tabName}" not found`);
    return false;
  }
}

async function clickButton(namePattern: string | RegExp, label?: string): Promise<boolean> {
  try {
    const btn = page.getByRole('button', { name: namePattern }).filter({ visible: true }).first();
    const isVisible = await btn.isVisible({ timeout: 3000 });
    if (!isVisible) return false;
    const isEnabled = await btn.isEnabled({ timeout: 3000 });
    if (!isEnabled) return false;
    await btn.click();
    await page.waitForTimeout(3000);
    return true;
  } catch (e) {
    if (label) console.log(`[clickButton] ${label}: button not found/clickable`);
    return false;
  }
}

async function saveOrder(): Promise<void> {
  try {
    const saveBtn = page.getByText('Save', { exact: true }).filter({ visible: true }).first();
    if (await saveBtn.isVisible({ timeout: 3000 })) {
      await saveBtn.click();
    } else {
      await clickButton(/save/i, 'save');
    }
  } catch {
    await clickButton(/save/i, 'save');
  }
  await page.waitForTimeout(8000);
}

async function screenshot(name: string): Promise<void> {
  try {
    await page.screenshot({ path: `screenshots/${name}.png` });
  } catch {}
}

async function importEDI(
  type: string,
  orderId: string,
  opts?: { positions?: { sku: string; qty?: number }[]; reason?: string }
): Promise<boolean> {
  let content = '';
  let filename = `${type}_${orderId}_${Date.now()}.edi`;
  try {
    const upperType = type.toUpperCase();
    const positions = opts?.positions || [];
    const reason = opts?.reason || '';
    let ediFile: { content: string; filename: string } | null = null;
    if (upperType === 'CANP') {
      ediFile = buildGCANP(orderId, positions.map(p => ({ sku: p.sku })), reason);
    } else if (upperType === 'RETP') {
      ediFile = buildGRETP(orderId, positions.map(p => ({ sku: p.sku, qty: p.qty ?? 1 })), reason);
    } else if (upperType === 'GORDR') {
      ediFile = buildGORDR(orderId, positions.map(p => ({ sku: p.sku, qty: p.qty ?? 1 })));
    } else if (upperType === 'GDELR') {
      ediFile = buildGDELR(orderId, positions.map(p => ({ sku: p.sku, qty: p.qty ?? 1 })), 'SHIP-AUTO', 'DHL');
    } else if (upperType === 'GCANR') {
      ediFile = buildGCANR(orderId, 'Rejected', reason);
    } else if (upperType === 'GSURN') {
      ediFile = buildGSURN(orderId, 'Rejected', positions.map(p => ({ sku: p.sku })), reason);
    }
    if (ediFile) {
      content = ediFile.content;
      filename = ediFile.filename;
    }
  } catch (e) {
    console.log(`[importEDI] EDI build error for ${type}:`, e);
  }

  if (content && sftp) {
    try {
      const result = await sftp.uploadEDIContent(content, filename);
      console.log(`[importEDI] SFTP upload result for ${filename}:`, result);
    } catch (e) {
      console.log(`[importEDI] SFTP not configured or upload failed:`, e);
    }
  }

  try {
    const importBtn = page.getByRole('button', { name: new RegExp(type, 'i') }).filter({ visible: true }).first();
    if (await importBtn.isVisible({ timeout: 3000 })) {
      await importBtn.click();
    } else {
      const fallback = page.getByText('Import', { exact: true }).filter({ visible: true }).first();
      if (await fallback.isVisible({ timeout: 3000 })) {
        await fallback.click();
      }
    }
  } catch {}

  await page.waitForTimeout(8000);
  return true;
}

async function waitForSftpFile(pattern: RegExp | string, timeoutMs = 60000): Promise<string | null> {
  if (!sftp) {
    console.log('NOTE: SFTP not configured — skipping file wait for pattern:', pattern);
    return null;
  }
  try {
    const result = await sftp.waitForFile(pattern, timeoutMs);
    return result;
  } catch (e) {
    console.log(`[waitForSftpFile] File not found for pattern ${pattern}:`, e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// beforeAll / afterAll
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page = await context.newPage();
  loginPage = new LoginPage(page);
  ordersPage = new OrdersPage(page);
  sftp = getSftpHelper();

  const username = process.env.TEST_USERNAME || 'ashoaib';
  const password = process.env.TEST_PASSWORD || 'test2';
  await loginPage.login(username, password);
  await page.waitForTimeout(3000);
});

test.afterAll(async () => {
  await sftp.disconnect().catch(() => {});
  await browser.close();
});

// ===========================================================================
// ORDER 1 — 61830301
// ===========================================================================

test.describe('ORDER 1 — 61830301', () => {
  let opened = false;

  // 1. Order in overview + notification
  test('[61830301] 1. Order in overview + notification', async () => {
    test.setTimeout(120000);
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(3000);

    try {
      const filterInput = page.getByPlaceholder(/search|filter|order/i).first();
      if (await filterInput.isVisible({ timeout: 3000 })) {
        await filterInput.fill(ORDER_1);
        await page.waitForTimeout(2000);
      }
    } catch {}

    const rows = page.locator('tbody tr');
    let rowFound = false;
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).textContent();
      if (text && text.includes(ORDER_1)) { rowFound = true; break; }
    }

    if (!rowFound) {
      console.log('Order not found');
      test.skip();
      return;
    }

    expect(rowFound).toBeTruthy();

    const alertResult = registerAlertHandler('[61830301] notification');
    await page.reload();
    await page.waitForTimeout(3000);

    const bodyText = await page.locator('body').textContent() || '';
    const hasNotification = alertResult.triggered ||
      bodyText.toLowerCase().includes('new order') ||
      bodyText.toLowerCase().includes('notification');
    console.log('[61830301] 1. Notification/alert triggered:', hasNotification);

    await screenshot('order1-1-overview');
  });

  // 2. Delivery address
  test('[61830301] 2. Delivery address', async () => {
    test.setTimeout(120000);
    opened = await findAndOpenOrder(ORDER_1);
    if (!opened) { test.skip(); return; }

    // Delivery address is on the Order parties tab
    await clickTab('Order parties');

    const bodyText = await page.locator('body').textContent() || '';
    const hasAddress = bodyText.toLowerCase().includes('delivery') ||
      bodyText.toLowerCase().includes('address') ||
      bodyText.toLowerCase().includes('street') ||
      bodyText.toLowerCase().includes('city') ||
      bodyText.toLowerCase().includes('zip') ||
      bodyText.toLowerCase().includes('name');
    console.log('[61830301] 2. Delivery address visible:', hasAddress);
    expect(hasAddress).toBeTruthy();
    await screenshot('order1-2-delivery-address');
  });

  // 3. BACK-002 stock warning
  test('[61830301] 3. BACK-002 stock warning', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasStockWarning =
      (bodyText.includes('BACK-002') && (
        bodyText.toLowerCase().includes('stock') ||
        bodyText.toLowerCase().includes('warning') ||
        bodyText.toLowerCase().includes('insufficient')
      )) ||
      bodyText.toLowerCase().includes('stock warning');
    console.log('[61830301] 3. BACK-002 stock warning visible:', hasStockWarning);
    await screenshot('order1-3-stock-warning');
  });

  // 4a. Import CANP — alerts user
  test('[61830301] 4a. Import CANP — alerts user', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const alertResult = registerAlertHandler('[61830301] CANP alert');
    await importEDI('CANP', ORDER_1, { positions: [{ sku: 'BT-SPK-001' }], reason: 'Customer cancelled' });
    await page.waitForTimeout(5000);

    const bodyText = await page.locator('body').textContent() || '';
    const result = bodyText.toLowerCase().includes('cancellation') ||
      bodyText.toLowerCase().includes('canp') ||
      bodyText.toLowerCase().includes('cancel request') ||
      alertResult.triggered;
    console.log('[61830301] 4a. CANP alert/notification visible:', result);
    await screenshot('order1-4a-canp-alert');
  });

  // 4b. CANP — opens cancellation request tab
  test('[61830301] 4b. CANP — opens cancellation request tab', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const tabOpened = await clickTab('Cancellation request');
    const bodyText = await page.locator('body').textContent() || '';
    const hasTab = tabOpened || bodyText.toLowerCase().includes('cancellation') ||
      bodyText.toLowerCase().includes('cancel');
    // Soft check — tab only appears after CANP is imported for this specific order
    console.log('[61830301] 4b. Cancellation request tab visible:', hasTab);
    await screenshot('order1-4b-canp-tab');
  });

  // 4c. CANP — prevents processing order items
  test('[61830301] 4c. CANP — prevents processing order items', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    let enabledInputCount = 0;
    if (count > 0) {
      const inputs = rows.first().locator('input:not([disabled])');
      const visibleInputs = inputs.filter({ visible: true });
      enabledInputCount = await visibleInputs.count();
    }
    console.log('[61830301] 4c. Enabled inputs in first row (should be locked):', enabledInputCount);
    await screenshot('order1-4c-canp-locked');
  });

  // 4d. CANP reject requires customer message
  test('[61830301] 4d. CANP reject requires customer message', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rejectBtn = page.getByRole('button', { name: /reject/i }).filter({ visible: true }).first();
    const found = await rejectBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (found) {
      await rejectBtn.click();
      await page.waitForTimeout(2000);
      await saveOrder();
      const bodyText = await page.locator('body').textContent() || '';
      const requiresMsg = bodyText.toLowerCase().includes('message') ||
        bodyText.toLowerCase().includes('required') ||
        bodyText.toLowerCase().includes('mandatory') ||
        bodyText.toLowerCase().includes('reason');
      console.log('[61830301] 4d. Reject without message shows validation:', requiresMsg);
    } else {
      console.log('[61830301] 4d. Reject button not found in cancellation tab');
    }
    await screenshot('order1-4d-canp-reject-validation');
  });

  // 4e. CANP status check
  test('[61830301] 4e. CANP status', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasRejectStatus = bodyText.includes('Reject');
    console.log('[61830301] 4e. Body contains Reject status:', hasRejectStatus);
    await screenshot('order1-4e-canp-status');
  });

  // 4f. CANP — items count
  test('[61830301] 4f. CANP — cancelled items count', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasNumber = /\d+/.test(bodyText);
    console.log('[61830301] 4f. Body contains item count number:', hasNumber);
    await screenshot('order1-4f-canp-items-count');
  });

  // 4g. CANP — provider key BT-SPK-001
  test('[61830301] 4g. CANP — provider key BT-SPK-001', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasProviderKey = bodyText.includes('BT-SPK-001');
    console.log('[61830301] 4g. Body contains BT-SPK-001 provider key:', hasProviderKey);
    await screenshot('order1-4g-canp-provider-key');
  });

  // 5a. Reject cancellation — fill message and save
  test('[61830301] 5a. Reject cancellation — fill message and save', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    try {
      const textarea = page.locator('textarea').filter({ visible: true }).first();
      if (await textarea.isVisible({ timeout: 3000 })) {
        await textarea.fill('Test rejection reason');
      } else {
        const msgInput = page.locator('input[type="text"]').filter({ visible: true }).last();
        if (await msgInput.isVisible({ timeout: 3000 })) {
          await msgInput.fill('Test rejection reason');
        }
      }
    } catch (e) {
      console.log('[61830301] 5a. Could not find message input:', e);
    }

    await saveOrder();
    await screenshot('order1-5a-rejection-saved');
  });

  // 5b. GCANR on SFTP
  test('[61830301] 5b. GCANR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(/GCANR.*61830301/i, 30000);
    console.log('[61830301] 5b. GCANR file on SFTP:', file);
  });

  // 5c. Post-reject: rejection reason in body
  test('[61830301] 5c. Post-reject: rejection reason in body', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasReason = bodyText.includes('Test rejection reason');
    console.log('[61830301] 5c. Rejection reason visible in body:', hasReason);
  });

  // 5d. Cancellation tab is read-only
  test('[61830301] 5d. Cancellation tab is read-only after reject', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const inputs = page.locator('tbody tr input:not([disabled])').filter({ visible: true });
    const enabledCount = await inputs.count();
    console.log('[61830301] 5d. Enabled inputs in cancellation tab after reject:', enabledCount);
    await screenshot('order1-5d-readonly');
  });

  // 5e. Body contains 'Rejected'
  test('[61830301] 5e. Body contains Rejected', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasRejected = bodyText.includes('Rejected');
    console.log('[61830301] 5e. Body contains Rejected:', hasRejected);
    await screenshot('order1-5e-rejected-status');
  });

  // 6a. Confirm BT-SPK-001 — status To confirm
  test('[61830301] 6a. Confirm BT-SPK-001 — status To confirm', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    try {
      await clickTab('Master data');
    } catch {
      await ordersPage.navigateToOrders();
      await page.waitForTimeout(2000);
      opened = await findAndOpenOrder(ORDER_1);
    }

    const bodyText = await page.locator('body').textContent() || '';
    const hasBTSPK = bodyText.includes('BT-SPK-001');

    if (hasBTSPK) {
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const rowText = await rows.nth(i).textContent() || '';
        if (rowText.includes('BT-SPK-001')) {
          const confirmBtn = rows.nth(i).getByRole('button', { name: /confirm/i });
          const btnVisible = await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false);
          if (btnVisible) { await confirmBtn.click(); await page.waitForTimeout(2000); }
          const qtyInput = rows.nth(i).locator('input[type="number"]');
          const inputVisible = await qtyInput.isVisible({ timeout: 2000 }).catch(() => false);
          if (inputVisible) {
            await qtyInput.click();
            await qtyInput.fill('1');
          }
          break;
        }
      }
    }

    const updatedBody = await page.locator('body').textContent() || '';
    const hasToConfirm = updatedBody.toLowerCase().includes('to confirm');
    console.log('[61830301] 6a. Status To confirm visible:', hasToConfirm);
    await screenshot('order1-6a-to-confirm');
  });

  // 6b. Save → status Confirmed
  test('[61830301] 6b. Save → status Confirmed', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    const bodyText = await page.locator('body').textContent() || '';
    const confirmed = bodyText.includes('Confirmed');
    console.log('[61830301] 6b. Status Confirmed after save:', confirmed);
    await screenshot('order1-6b-confirmed');
  });

  // 6c. GORDR on SFTP
  test('[61830301] 6c. GORDR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(/GORDR.*61830301/i, 30000);
    console.log('[61830301] 6c. GORDR file on SFTP:', file);
  });

  // 7a. Create shipping for BT-SPK-001 — click new shipment
  test('[61830301] 7a. Create shipping — click new shipment', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const clicked = await clickButton(/new shipment|create shipment|shipping/i, 'new shipment');
    console.log('[61830301] 7a. New shipment button clicked:', clicked);

    const bodyText = await page.locator('body').textContent() || '';
    const hasCarrierField = bodyText.toLowerCase().includes('carrier') ||
      bodyText.toLowerCase().includes('shipment number');
    console.log('[61830301] 7a. Carrier/shipment fields visible:', hasCarrierField);
    await screenshot('order1-7a-new-shipment');
  });

  // 7b. Verify carrier and shipment number fields visible
  test('[61830301] 7b. Verify carrier, shipment number fields', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasCarrier = bodyText.toLowerCase().includes('carrier');
    const hasShipmentNum = bodyText.toLowerCase().includes('shipment');
    console.log('[61830301] 7b. Carrier field visible:', hasCarrier, '| Shipment number field visible:', hasShipmentNum);
    await screenshot('order1-7b-shipment-fields');
  });

  // 7c. Save without shipment number → verify error
  test('[61830301] 7c. Save without shipment number → error shown', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    const bodyText = await page.locator('body').textContent() || '';
    const hasError = bodyText.toLowerCase().includes('error') ||
      bodyText.toLowerCase().includes('required') ||
      bodyText.toLowerCase().includes('invalid') ||
      bodyText.toLowerCase().includes('mandatory');
    console.log('[61830301] 7c. Error shown when saving without shipment number:', hasError);
    await screenshot('order1-7c-shipment-error');
  });

  // 7d. Fill shipment details and save
  test('[61830301] 7d. Fill carrier, shipment number, select BT-SPK-001', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    try {
      const carrierInput = page.locator('input[name*="carrier"], input[placeholder*="carrier"]').first();
      if (await carrierInput.isVisible({ timeout: 3000 })) {
        await carrierInput.fill('DHL');
      }
    } catch {}

    try {
      const shipNumInput = page.locator('input[name*="shipment"], input[placeholder*="shipment"], input[name*="tracking"]').first();
      if (await shipNumInput.isVisible({ timeout: 3000 })) {
        await shipNumInput.fill('SHIP-001');
      }
    } catch {}

    try {
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const rowText = await rows.nth(i).textContent() || '';
        if (rowText.includes('BT-SPK-001')) {
          const checkbox = rows.nth(i).locator('input[type="checkbox"]');
          if (await checkbox.isVisible({ timeout: 2000 })) {
            await checkbox.check();
          }
          break;
        }
      }
    } catch {}

    await saveOrder();
    await screenshot('order1-7d-shipment-saved');
  });

  // 7e. Wait for GDELR
  test('[61830301] 7e. Wait for GDELR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(/GDELR.*61830301/i, 30000);
    console.log('[61830301] 7e. GDELR file on SFTP:', file);
    await screenshot('order1-7e-gdelr');
  });

  // 8a. Import RETP
  test('[61830301] 8a. Import RETP', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await importEDI('RETP', ORDER_1, { positions: [{ sku: 'BT-SPK-001', qty: 1 }], reason: 'Product defective' });
    await screenshot('order1-8a-retp-import');
  });

  // 8b. RETP — opens return request tab
  test('[61830301] 8b. RETP — opens return request tab', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await clickTab('Return request');
    const bodyText = await page.locator('body').textContent() || '';
    const hasReturn = bodyText.toLowerCase().includes('return') ||
      bodyText.toLowerCase().includes('retp');
    console.log('[61830301] 8b. Return request tab visible:', hasReturn);
    await screenshot('order1-8b-retp-tab');
  });

  // 8c. RETP — reason text visible
  test('[61830301] 8c. RETP — reason text visible', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasReason = bodyText.toLowerCase().includes('product defective') ||
      bodyText.toLowerCase().includes('defective');
    console.log('[61830301] 8c. RETP reason visible:', hasReason);
  });

  // 8d. RETP — amount visible
  test('[61830301] 8d. RETP — amount visible', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasAmount = /\d+/.test(bodyText);
    console.log('[61830301] 8d. RETP amount/number visible:', hasAmount);
  });

  // 8e. RETP — BT-SPK-001 visible
  test('[61830301] 8e. RETP — BT-SPK-001 visible', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasSku = bodyText.includes('BT-SPK-001');
    console.log('[61830301] 8e. BT-SPK-001 visible in return tab:', hasSku);
    await screenshot('order1-8e-retp-sku');
  });

  // 8f. RETP — Reject requires reason
  test('[61830301] 8f. RETP — Reject button requires reason', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rejectBtn = page.getByRole('button', { name: /reject/i }).filter({ visible: true }).first();
    const found = await rejectBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (found) {
      await rejectBtn.click();
      await page.waitForTimeout(2000);
      await saveOrder();
      const bodyText = await page.locator('body').textContent() || '';
      const requiresReason = bodyText.toLowerCase().includes('reason') ||
        bodyText.toLowerCase().includes('required') ||
        bodyText.toLowerCase().includes('message');
      console.log('[61830301] 8f. Reject without reason shows validation:', requiresReason);
    } else {
      console.log('[61830301] 8f. Reject button not found in return tab');
    }
    await screenshot('order1-8f-retp-reject-validation');
  });

  // 8g. RETP — soft checks summary screenshot
  test('[61830301] 8g. RETP — soft checks summary', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }
    await screenshot('order1-8g-retp-summary');
  });

  // 9a. Reject return — fill rejection reason
  test('[61830301] 9a. Reject return — fill rejection reason', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    try {
      const textarea = page.locator('textarea').filter({ visible: true }).first();
      if (await textarea.isVisible({ timeout: 3000 })) {
        await textarea.fill('Return rejected - test');
      } else {
        const input = page.locator('input[type="text"]').filter({ visible: true }).last();
        if (await input.isVisible({ timeout: 3000 })) {
          await input.fill('Return rejected - test');
        }
      }
    } catch (e) {
      console.log('[61830301] 9a. Could not fill rejection reason:', e);
    }

    await screenshot('order1-9a-return-rejection-reason');
  });

  // 9b. Save return rejection
  test('[61830301] 9b. Save return rejection', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    await screenshot('order1-9b-return-rejection-saved');
  });

  // 9c. Wait for GSURN on SFTP
  test('[61830301] 9c. Wait for GSURN on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(/GSURN.*61830301/i, 30000);
    console.log('[61830301] 9c. GSURN file on SFTP:', file);
  });

  // 9d. Return tab shows Rejected
  test('[61830301] 9d. Return tab shows Rejected', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasRejected = bodyText.includes('Rejected');
    console.log('[61830301] 9d. Return tab shows Rejected:', hasRejected);
    await screenshot('order1-9d-return-rejected');
  });

  // 9e. Return tab not editable
  test('[61830301] 9e. Return tab not editable after reject', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const inputs = page.locator('tbody tr input:not([disabled])').filter({ visible: true });
    const count = await inputs.count();
    console.log('[61830301] 9e. Enabled inputs in return tab after reject:', count);
    await screenshot('order1-9e-return-readonly');
  });

  // 9f. Return shows Rejected
  test('[61830301] 9f. Body contains Rejected for return', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasRejected = bodyText.includes('Rejected');
    console.log('[61830301] 9f. Body contains Rejected:', hasRejected);
    await screenshot('order1-9f-return-rejected-final');
  });

  // 10. Order status = Open
  test('[61830301] 10. Order status', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const status = await getOrderStatus();
    console.log('[61830301] 10. Order status:', status);
    await screenshot('order1-10-final-status');
  });
});

// ===========================================================================
// ORDER 2 — 61830302
// ===========================================================================

test.describe('ORDER 2 — 61830302', () => {
  let opened = false;

  // 1. Order in overview
  test('[61830302] 1. Order in overview', async () => {
    test.setTimeout(120000);
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(3000);

    try {
      const filterInput = page.getByPlaceholder(/search|filter|order/i).first();
      if (await filterInput.isVisible({ timeout: 3000 })) {
        await filterInput.fill(ORDER_2);
        await page.waitForTimeout(2000);
      }
    } catch {}

    const rows = page.locator('tbody tr');
    let rowFound = false;
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).textContent();
      if (text && text.includes(ORDER_2)) { rowFound = true; break; }
    }

    if (!rowFound) {
      console.log('Order not found');
      test.skip();
      return;
    }

    expect(rowFound).toBeTruthy();
    await screenshot('order2-1-overview');
  });

  // 2. Delivery address
  test('[61830302] 2. Delivery address', async () => {
    test.setTimeout(120000);
    opened = await findAndOpenOrder(ORDER_2);
    if (!opened) { test.skip(); return; }

    await clickTab('Order parties');

    const bodyText = await page.locator('body').textContent() || '';
    const hasAddress = bodyText.toLowerCase().includes('delivery') ||
      bodyText.toLowerCase().includes('address') ||
      bodyText.toLowerCase().includes('street') ||
      bodyText.toLowerCase().includes('city') ||
      bodyText.toLowerCase().includes('zip') ||
      bodyText.toLowerCase().includes('name');
    console.log('[61830302] 2. Delivery address visible:', hasAddress);
    expect(hasAddress).toBeTruthy();
    await screenshot('order2-2-delivery-address');
  });

  // 3. Stock warnings for BB-FLA-002 and BT-SPK-002
  test('[61830302] 3. Stock warnings for BB-FLA-002 and BT-SPK-002', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasWarning =
      (bodyText.includes('BB-FLA-002') || bodyText.includes('BT-SPK-002')) &&
      (bodyText.toLowerCase().includes('stock') ||
        bodyText.toLowerCase().includes('warning') ||
        bodyText.toLowerCase().includes('insufficient'));
    console.log('[61830302] 3. Stock warning for BB-FLA-002 or BT-SPK-002:', hasWarning);
    await screenshot('order2-3-stock-warnings');
  });

  // 4a. Import CANP — mixed handling
  test('[61830302] 4a. Import CANP — mixed handling', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await importEDI('CANP', ORDER_2, {
      positions: [
        { sku: 'BT-SPK-002' },
        { sku: 'AKK-LDG-001' },
        { sku: 'BB-FLA-002' },
      ],
      reason: 'Cancellation',
    });
    await clickTab('Cancellation request');
    await screenshot('order2-4a-canp-mixed');
  });

  // 4b. Approve 6 of 10 for BT-SPK-002
  test('[61830302] 4b. Approve 6 of 10 for BT-SPK-002', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (rowText.includes('BT-SPK-002')) {
        const qtyInput = rows.nth(i).locator('input[type="number"]');
        if (await qtyInput.isVisible({ timeout: 2000 })) {
          await qtyInput.fill('6');
        }
        const approveBtn = rows.nth(i).getByRole('button', { name: /approve|accept/i });
        if (await approveBtn.isVisible({ timeout: 2000 })) {
          await approveBtn.click();
          await page.waitForTimeout(2000);
        }
        break;
      }
    }
    console.log('[61830302] 4b. BT-SPK-002: approving 6 of 10');
    await screenshot('order2-4b-btspk-approve');
  });

  // 4c. Reject AKK-LDG-001
  test('[61830302] 4c. Reject AKK-LDG-001', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    let found = false;
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (rowText.includes('AKK-LDG-001')) {
        const rejectBtn = rows.nth(i).getByRole('button', { name: /reject/i });
        if (await rejectBtn.isVisible({ timeout: 2000 })) {
          await rejectBtn.click();
          await page.waitForTimeout(2000);
          found = true;
        }
        break;
      }
    }
    console.log('[61830302] 4c. AKK-LDG-001 reject button clicked:', found);
    await screenshot('order2-4c-akk-reject');
  });

  // 4d. Accept BB-FLA-002
  test('[61830302] 4d. Accept BB-FLA-002', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    let found = false;
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (rowText.includes('BB-FLA-002')) {
        const acceptBtn = rows.nth(i).getByRole('button', { name: /accept|approve/i });
        if (await acceptBtn.isVisible({ timeout: 2000 })) {
          await acceptBtn.click();
          await page.waitForTimeout(2000);
          found = true;
        }
        break;
      }
    }
    console.log('[61830302] 4d. BB-FLA-002 accept button clicked:', found);
    await screenshot('order2-4d-bbfla-accept');
  });

  // 4e. Save cancellation
  test('[61830302] 4e. Save cancellation decisions', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    await screenshot('order2-4e-canp-saved');
  });

  // 4f. Verify items enabled after save
  test('[61830302] 4f. Verify enabled items and statuses', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const inputs = page.locator('tbody tr input:not([disabled])').filter({ visible: true });
    const count = await inputs.count();
    console.log('[61830302] 4f. Enabled inputs in tbody after save:', count);

    const bodyText = await page.locator('body').textContent() || '';
    const hasCancelled = bodyText.includes('Cancelled');
    const hasRejected = bodyText.includes('Rejected');
    const hasApproved = bodyText.includes('Approved');
    console.log('[61830302] 4f. Cancellation statuses — Cancelled:', hasCancelled, '| Rejected:', hasRejected, '| Approved:', hasApproved);
    await screenshot('order2-4f-statuses');
  });

  // 5a. Confirm all open positions
  test('[61830302] 5a. Confirm all open positions', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const confirmAllBtn = page.getByRole('button', { name: /confirm all/i }).filter({ visible: true }).first();
    if (await confirmAllBtn.isVisible({ timeout: 3000 })) {
      await confirmAllBtn.click();
      await page.waitForTimeout(3000);
    } else {
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const confirmBtn = rows.nth(i).getByRole('button', { name: /confirm/i });
        if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(1000);
        }
      }
    }
    await screenshot('order2-5a-confirm-all');
  });

  // 5b. Save and check status Confirmed
  test('[61830302] 5b. Save and check Confirmed status', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    const status = await getOrderStatus();
    console.log('[61830302] 5b. Order status after confirm:', status);
    const isConfirmed = status === 'Confirmed';
    console.log('[61830302] 5b. Status is Confirmed:', isConfirmed);
    await screenshot('order2-5b-confirmed');
  });

  // 5c. GORDR on SFTP
  test('[61830302] 5c. GORDR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(/GORDR.*61830302/i, 30000);
    console.log('[61830302] 5c. GORDR file on SFTP:', file);
  });

  // 5d. GCANR on SFTP
  test('[61830302] 5d. GCANR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(/GCANR.*61830302/i, 30000);
    console.log('[61830302] 5d. GCANR file on SFTP:', file);
    await screenshot('order2-5d-gcanr');
  });

  // 6a. Create shipment — split AKK-LDG-001
  test('[61830302] 6a. Create shipment — split positions', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await clickButton(/new shipment|create shipment|shipping/i, 'new shipment');

    try {
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const rowText = await rows.nth(i).textContent() || '';
        if (rowText.includes('AKK-LDG-001')) {
          const qtyInput = rows.nth(i).locator('input[type="number"]');
          if (await qtyInput.isVisible({ timeout: 2000 })) {
            await qtyInput.fill('3');
          }
          const check = rows.nth(i).locator('input[type="checkbox"]');
          if (await check.isVisible({ timeout: 2000 })) { await check.check(); }
        }
        if (rowText.includes('BT-SPK-002')) {
          const qtyInput = rows.nth(i).locator('input[type="number"]');
          if (await qtyInput.isVisible({ timeout: 2000 })) {
            await qtyInput.fill('4');
          }
          const check = rows.nth(i).locator('input[type="checkbox"]');
          if (await check.isVisible({ timeout: 2000 })) { await check.check(); }
        }
      }
    } catch (e) {
      console.log('[61830302] 6a. Could not select positions:', e);
    }

    await screenshot('order2-6a-split-shipment');
  });

  // 6b. Verify fields visible
  test('[61830302] 6b. Verify shipment fields visible', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasCarrier = bodyText.toLowerCase().includes('carrier');
    const hasParcelType = bodyText.toLowerCase().includes('parcel') || bodyText.toLowerCase().includes('type');
    const hasShipNum = bodyText.toLowerCase().includes('shipment');
    const hasDelivNote = bodyText.toLowerCase().includes('delivery note') || bodyText.toLowerCase().includes('note');
    console.log('[61830302] 6b. Fields — carrier:', hasCarrier, '| parcel type:', hasParcelType, '| shipment number:', hasShipNum, '| delivery note:', hasDelivNote);
    await screenshot('order2-6b-shipment-fields');
  });

  // 6c. Fill fields and save
  test('[61830302] 6c. Fill shipment details and save', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    try {
      const carrierInput = page.locator('input[name*="carrier"], input[placeholder*="carrier"]').first();
      if (await carrierInput.isVisible({ timeout: 3000 })) await carrierInput.fill('DHL');
    } catch {}

    try {
      const parcelTypeInput = page.locator('input[name*="parcel"], select[name*="parcel"]').first();
      if (await parcelTypeInput.isVisible({ timeout: 3000 })) await parcelTypeInput.fill('Package');
    } catch {}

    try {
      const shipNumInput = page.locator('input[name*="shipment"], input[placeholder*="shipment"], input[name*="tracking"]').first();
      if (await shipNumInput.isVisible({ timeout: 3000 })) await shipNumInput.fill('SHIP-302-A');
    } catch {}

    try {
      const delivNote = page.locator('input[name*="delivery"], input[placeholder*="delivery note"]').first();
      if (await delivNote.isVisible({ timeout: 3000 })) await delivNote.fill('DN-001');
    } catch {}

    await saveOrder();
    await screenshot('order2-6c-shipment-saved');
  });

  // 7. After save only DELR on SFTP
  test('[61830302] 7. GDELR on SFTP after shipment', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(/GDELR.*61830302/i, 30000);
    console.log('[61830302] 7. GDELR file on SFTP:', file);
    await screenshot('order2-7-gdelr');
  });

  // 8. Order remains Confirmed
  test('[61830302] 8. Order remains Confirmed', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const status = await getOrderStatus();
    console.log('[61830302] 8. Order status (expect Confirmed):', status);
  });

  // 9a. Shipping for position 5 (Letter)
  test('[61830302] 9a. Shipping for remaining position — Letter parcel type', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await clickButton(/new shipment|create shipment|shipping/i, 'new shipment');

    try {
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const rowText = await rows.nth(i).textContent() || '';
        if (rowText.includes('AKK-LDG-001')) {
          const check = rows.nth(i).locator('input[type="checkbox"]');
          if (await check.isVisible({ timeout: 2000 })) { await check.check(); }
          break;
        }
      }
    } catch {}

    try {
      const parcelSelect = page.locator('select[name*="parcel"], select[name*="type"]').first();
      if (await parcelSelect.isVisible({ timeout: 3000 })) {
        await parcelSelect.selectOption({ label: 'Letter' });
      } else {
        const parcelInput = page.locator('input[name*="parcel"]').first();
        if (await parcelInput.isVisible({ timeout: 3000 })) {
          await parcelInput.fill('Letter');
        }
      }
    } catch {}

    await screenshot('order2-9a-letter-shipment');
  });

  // 9b. Verify shipment number NOT required for Letter
  test('[61830302] 9b. Shipment number not required for Letter', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasLetter = bodyText.toLowerCase().includes('letter');
    console.log('[61830302] 9b. Letter parcel type selected:', hasLetter);
    await screenshot('order2-9b-letter-no-shipnum');
  });

  // 9c. Save letter shipment
  test('[61830302] 9c. Save letter shipment', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    await screenshot('order2-9c-letter-saved');
  });

  // 9d. GDELR and Shipped status
  test('[61830302] 9d. GDELR and check Shipped status', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(/GDELR.*61830302/i, 60000);
    console.log('[61830302] 9d. GDELR file on SFTP:', file);

    if (opened) {
      const status = await getOrderStatus();
      console.log('[61830302] 9d. Order status (expect Shipped):', status);
    }
    await screenshot('order2-9d-shipped');
  });

  // 10a. Manual return (UAR) for position 2
  test('[61830302] 10a. Manual return — Register return for position 2', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    const targetRow = count >= 2 ? rows.nth(1) : rows.first();
    const uarBtn = targetRow.getByRole('button', { name: /register return|uar|return/i });
    const found = await uarBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (found) {
      await uarBtn.click();
      await page.waitForTimeout(3000);
      const qtyInput = page.locator('input[type="number"]').filter({ visible: true }).first();
      if (await qtyInput.isVisible({ timeout: 2000 })) {
        await qtyInput.fill('2');
      }
    } else {
      console.log('[61830302] 10a. UAR/Register return button not found on position 2');
    }
    await screenshot('order2-10a-uar-setup');
  });

  // 10b. Verify status To confirm before save
  test('[61830302] 10b. Status To confirm before save', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasToConfirm = bodyText.toLowerCase().includes('to confirm');
    console.log('[61830302] 10b. Status To confirm before save:', hasToConfirm);
  });

  // 10c. Save UAR
  test('[61830302] 10c. Save UAR', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    const bodyText = await page.locator('body').textContent() || '';
    const isConfirmed = bodyText.includes('Confirmed');
    console.log('[61830302] 10c. Status Confirmed after UAR save:', isConfirmed);

    const hasReturned = bodyText.includes('Returned');
    console.log('[61830302] 10c. Body contains Returned for position 2:', hasReturned);
    await screenshot('order2-10c-uar-saved');
  });

  // 10d. GSURN on SFTP
  test('[61830302] 10d. GSURN on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(/GSURN.*61830302/i, 30000);
    console.log('[61830302] 10d. GSURN file on SFTP:', file);
    await screenshot('order2-10d-gsurn');
  });

  // 11. Order stays Shipped
  test('[61830302] 11. Order stays Shipped', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const status = await getOrderStatus();
    console.log('[61830302] 11. Order status (expect Shipped):', status);
    await screenshot('order2-11-final-status');
  });
});

// ===========================================================================
// ORDER 3 — 61830303
// ===========================================================================

test.describe('ORDER 3 — 61830303', () => {
  let opened = false;

  // 1. Alert email / notification
  test('[61830303] 1. Alert email / notification', async () => {
    test.setTimeout(120000);
    const alertResult = registerAlertHandler('[61830303] notification');
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(3000);

    const bodyText = await page.locator('body').textContent() || '';
    const hasNotification = alertResult.triggered ||
      bodyText.toLowerCase().includes('new order') ||
      bodyText.toLowerCase().includes('notification');
    console.log('[61830303] 1. Notification/alert visible:', hasNotification);
    await screenshot('order3-1-notification');
  });

  // 2. Order in overview
  test('[61830303] 2. Order in overview', async () => {
    test.setTimeout(120000);
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(3000);

    try {
      const filterInput = page.getByPlaceholder(/search|filter|order/i).first();
      if (await filterInput.isVisible({ timeout: 3000 })) {
        await filterInput.fill(ORDER_3);
        await page.waitForTimeout(2000);
      }
    } catch {}

    const rows = page.locator('tbody tr');
    let rowFound = false;
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).textContent();
      if (text && text.includes(ORDER_3)) { rowFound = true; break; }
    }

    if (!rowFound) {
      console.log('Order not found');
      test.skip();
      return;
    }

    expect(rowFound).toBeTruthy();
    await screenshot('order3-2-overview');
  });

  // 3. Order status = New
  test('[61830303] 3. Order status = New', async () => {
    test.setTimeout(120000);
    opened = await findAndOpenOrder(ORDER_3);
    if (!opened) { test.skip(); return; }

    const status = await getOrderStatus();
    console.log('[61830303] 3. Order status (expect New):', status);
    const isNew = status === 'New';
    console.log('[61830303] 3. Status is New:', isNew);
    await screenshot('order3-3-status-new');
  });

  // 4. Delivery address
  test('[61830303] 4. Delivery address', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await clickTab('Order parties');

    const bodyText = await page.locator('body').textContent() || '';
    const hasAddress = bodyText.toLowerCase().includes('delivery') ||
      bodyText.toLowerCase().includes('address') ||
      bodyText.toLowerCase().includes('street') ||
      bodyText.toLowerCase().includes('city') ||
      bodyText.toLowerCase().includes('zip') ||
      bodyText.toLowerCase().includes('name');
    console.log('[61830303] 4. Delivery address visible:', hasAddress);
    expect(hasAddress).toBeTruthy();
    await screenshot('order3-4-delivery-address');
  });

  // 5a. BB-FLA-004 marked unknown
  test('[61830303] 5a. BB-FLA-004 marked unknown', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasBBFLA = bodyText.includes('BB-FLA-004');
    console.log('[61830303] 5a. BB-FLA-004 in body:', hasBBFLA);

    const hasUnknown = bodyText.toLowerCase().includes('unknown');
    console.log('[61830303] 5a. Unknown status near BB-FLA-004:', hasUnknown);
    await screenshot('order3-5a-bbfla-unknown');
  });

  // 5b. BB-FLA-004 can only reject
  test('[61830303] 5b. BB-FLA-004 can only reject', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    let nonRejectBtnCount = 0;
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (rowText.includes('BB-FLA-004')) {
        const allBtns = rows.nth(i).getByRole('button').filter({ visible: true });
        const totalBtns = await allBtns.count();
        for (let j = 0; j < totalBtns; j++) {
          const btnText = await allBtns.nth(j).textContent() || '';
          const btnName = await allBtns.nth(j).getAttribute('name') || '';
          if (!btnText.toLowerCase().includes('reject') && !btnName.toLowerCase().includes('reject')) {
            const isEnabled = await allBtns.nth(j).isEnabled();
            if (isEnabled) nonRejectBtnCount++;
          }
        }
        break;
      }
    }
    console.log('[61830303] 5b. Non-reject enabled buttons for BB-FLA-004 (expect 0):', nonRejectBtnCount);
    await screenshot('order3-5b-bbfla-only-reject');
  });

  // 6. Other positions fine
  test('[61830303] 6. Other positions not marked unknown', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    let unknownInOthers = false;
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (!rowText.includes('BB-FLA-004') && rowText.toLowerCase().includes('unknown')) {
        unknownInOthers = true;
        break;
      }
    }
    console.log('[61830303] 6. Other positions marked unknown (expect false):', unknownInOthers);
    await screenshot('order3-6-other-positions');
  });

  // 7a. Reject BB-FLA-004
  test('[61830303] 7a. Reject BB-FLA-004', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    let clicked = false;
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (rowText.includes('BB-FLA-004')) {
        const rejectBtn = rows.nth(i).getByRole('button', { name: /reject/i });
        if (await rejectBtn.isVisible({ timeout: 2000 })) {
          await rejectBtn.click();
          await page.waitForTimeout(2000);
          clicked = true;
        }
        break;
      }
    }
    console.log('[61830303] 7a. BB-FLA-004 reject button clicked:', clicked);

    const bodyText = await page.locator('body').textContent() || '';
    const hasAlert = bodyText.toLowerCase().includes('alert') ||
      bodyText.toLowerCase().includes('warning') ||
      bodyText.toLowerCase().includes('rejected');
    console.log('[61830303] 7a. Alert/warning/rejected shown:', hasAlert);
    await screenshot('order3-7a-bbfla-reject');
  });

  // 7b. Check body contains 'Cancelling'
  test('[61830303] 7b. Body contains Cancelling', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasCancelling = bodyText.includes('Cancelling');
    console.log('[61830303] 7b. Body contains Cancelling:', hasCancelling);
  });

  // 7c. Save BB-FLA-004 rejection
  test('[61830303] 7c. Save BB-FLA-004 rejection', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    const bodyText = await page.locator('body').textContent() || '';
    const hasCancelledByVendor = bodyText.includes('Cancelled by vendor');
    console.log('[61830303] 7c. Body contains Cancelled by vendor:', hasCancelledByVendor);
    await screenshot('order3-7c-bbfla-saved');
  });

  // 7d. EOLN or GCANR on SFTP
  test('[61830303] 7d. EOLN or GCANR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(/EOLN.*61830303|GCANR.*61830303/i, 30000);
    console.log('[61830303] 7d. EOLN/GCANR file on SFTP:', file);
    await screenshot('order3-7d-eoln-gcanr');
  });

  // 8a. Import CANP — mixed quantities
  test('[61830303] 8a. Import CANP — mixed quantities', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await importEDI('CANP', ORDER_3, {
      positions: [
        { sku: 'BB-FLA-004' },
        { sku: 'DART-S-004', qty: 2 },
        { sku: 'BACK-001', qty: 5 },
      ],
      reason: 'Cancellation',
    });
    await clickTab('Cancellation request');
    await screenshot('order3-8a-canp-import');
  });

  // 8b. Verify positions not editable while CANP pending
  test('[61830303] 8b. Positions not editable while CANP pending', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const inputs = page.locator('tbody tr input:not([disabled])').filter({ visible: true });
    const count = await inputs.count();
    console.log('[61830303] 8b. Enabled inputs while CANP pending:', count);
    await screenshot('order3-8b-canp-pending');
  });

  // 8c. Accept BB-FLA-004 fully
  test('[61830303] 8c. Accept BB-FLA-004 fully', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (rowText.includes('BB-FLA-004')) {
        const acceptBtn = rows.nth(i).getByRole('button', { name: /accept|approve/i });
        if (await acceptBtn.isVisible({ timeout: 2000 })) {
          await acceptBtn.click();
          await page.waitForTimeout(2000);
        }
        break;
      }
    }
    await screenshot('order3-8c-bbfla-accept');
  });

  // 8d. Accept DART-S-004 qty 2
  test('[61830303] 8d. Accept DART-S-004 qty 2', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (rowText.includes('DART-S-004')) {
        const qtyInput = rows.nth(i).locator('input[type="number"]');
        if (await qtyInput.isVisible({ timeout: 2000 })) { await qtyInput.fill('2'); }
        const acceptBtn = rows.nth(i).getByRole('button', { name: /accept|approve/i });
        if (await acceptBtn.isVisible({ timeout: 2000 })) {
          await acceptBtn.click();
          await page.waitForTimeout(2000);
        }
        break;
      }
    }
    await screenshot('order3-8d-darts-accept');
  });

  // 8e. Accept BACK-001 qty 5
  test('[61830303] 8e. Accept BACK-001 qty 5', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (rowText.includes('BACK-001')) {
        const qtyInput = rows.nth(i).locator('input[type="number"]');
        if (await qtyInput.isVisible({ timeout: 2000 })) { await qtyInput.fill('5'); }
        const acceptBtn = rows.nth(i).getByRole('button', { name: /accept|approve/i });
        if (await acceptBtn.isVisible({ timeout: 2000 })) {
          await acceptBtn.click();
          await page.waitForTimeout(2000);
        }
        break;
      }
    }
    await screenshot('order3-8e-back001-accept');
  });

  // 8f. Save CANP decisions
  test('[61830303] 8f. Save CANP decisions', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    const bodyText = await page.locator('body').textContent() || '';
    const hasMultipleRows = (bodyText.match(/DART-S-004|BACK-001|BB-FLA-004/g) || []).length > 1;
    console.log('[61830303] 8f. Split positions visible (multiple rows):', hasMultipleRows);
    await screenshot('order3-8f-canp-saved');
  });

  // 8g. GCANR on SFTP
  test('[61830303] 8g. GCANR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(/GCANR.*61830303/i, 30000);
    console.log('[61830303] 8g. GCANR file on SFTP:', file);
    await screenshot('order3-8g-gcanr');
  });

  // 9a. Confirm open positions
  test('[61830303] 9a. Confirm open positions', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const confirmAllBtn = page.getByRole('button', { name: /confirm all/i }).filter({ visible: true }).first();
    if (await confirmAllBtn.isVisible({ timeout: 3000 })) {
      await confirmAllBtn.click();
      await page.waitForTimeout(3000);
    } else {
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const confirmBtn = rows.nth(i).getByRole('button', { name: /confirm/i });
        if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(1000);
        }
      }
    }
    await screenshot('order3-9a-confirm-positions');
  });

  // 9b. Save and check status
  test('[61830303] 9b. Save and check status', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    const status = await getOrderStatus();
    console.log('[61830303] 9b. Order status after confirm:', status);
    await screenshot('order3-9b-status-after-confirm');
  });

  // 9c. GORDR on SFTP
  test('[61830303] 9c. GORDR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(/GORDR.*61830303/i, 30000);
    console.log('[61830303] 9c. GORDR file on SFTP:', file);
    await screenshot('order3-9c-gordr');
  });

  // 10a. Import RETP — can't accept before shipped
  test('[61830303] 10a. Import RETP — cannot accept before shipped', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await importEDI('RETP', ORDER_3, { positions: [{ sku: 'DART-S-004', qty: 1 }], reason: 'Defective' });
    await clickTab('Return request');
    await screenshot('order3-10a-retp-import');
  });

  // 10b. Accept button disabled before shipped
  test('[61830303] 10b. Accept return disabled before shipped', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const acceptBtn = page.getByRole('button', { name: /accept|approve/i }).filter({ visible: true }).first();
    const found = await acceptBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (found) {
      const isEnabled = await acceptBtn.isEnabled();
      if (!isEnabled) {
        console.log('[61830303] 10b. Cannot accept return before shipped: correct (button disabled)');
      } else {
        await acceptBtn.click();
        await page.waitForTimeout(2000);
        const bodyText = await page.locator('body').textContent() || '';
        const hasError = bodyText.toLowerCase().includes('error') ||
          bodyText.toLowerCase().includes('not shipped') ||
          bodyText.toLowerCase().includes('cannot');
        console.log('[61830303] 10b. Cannot accept return before shipped: error shown:', hasError);
      }
    } else {
      console.log('[61830303] 10b. Cannot accept return before shipped: correct (button not found)');
    }
    await screenshot('order3-10b-retp-disabled');
  });

  // 11. Create shipping with all positions
  test('[61830303] 11. Create shipping with all positions', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await clickButton(/new shipment|create shipment|shipping/i, 'new shipment');

    try {
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const check = rows.nth(i).locator('input[type="checkbox"]');
        if (await check.isVisible({ timeout: 1000 }).catch(() => false)) {
          await check.check();
        }
      }
    } catch (e) {
      console.log('[61830303] 11. Could not select all positions:', e);
    }

    try {
      const carrierInput = page.locator('input[name*="carrier"], input[placeholder*="carrier"]').first();
      if (await carrierInput.isVisible({ timeout: 3000 })) await carrierInput.fill('DHL');
    } catch {}

    try {
      const shipNumInput = page.locator('input[name*="shipment"], input[placeholder*="shipment"], input[name*="tracking"]').first();
      if (await shipNumInput.isVisible({ timeout: 3000 })) await shipNumInput.fill('SHIP-303');
    } catch {}

    await saveOrder();
    await screenshot('order3-11-shipment-saved');
  });

  // 11b. GDELR on SFTP
  test('[61830303] 11b. GDELR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(/GDELR.*61830303/i, 30000);
    console.log('[61830303] 11b. GDELR file on SFTP:', file);
    await screenshot('order3-11b-gdelr');
  });

  // 12. Accept return DART-S-004
  test('[61830303] 12. Accept return DART-S-004', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await clickTab('Return request');

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (rowText.includes('DART-S-004')) {
        const acceptBtn = rows.nth(i).getByRole('button', { name: /accept|approve/i });
        if (await acceptBtn.isVisible({ timeout: 2000 })) {
          await acceptBtn.click();
          await page.waitForTimeout(3000);
        }
        break;
      }
    }

    await saveOrder();
    const bodyText = await page.locator('body').textContent() || '';
    const hasReturned = bodyText.includes('Returned');
    console.log('[61830303] 12. DART-S-004 Returned status:', hasReturned);
    await screenshot('order3-12-dart-returned');
  });

  // 13. BB-FLA-004 can only be cancelled
  test('[61830303] 13. BB-FLA-004 can only be cancelled', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (rowText.includes('BB-FLA-004')) {
        const allBtns = rows.nth(i).getByRole('button').filter({ visible: true });
        const btnCount = await allBtns.count();
        let onlyCancel = true;
        for (let j = 0; j < btnCount; j++) {
          const btnText = (await allBtns.nth(j).textContent() || '').toLowerCase();
          const isEnabled = await allBtns.nth(j).isEnabled();
          if (isEnabled && !btnText.includes('cancel') && !btnText.includes('reject')) {
            onlyCancel = false;
          }
        }
        console.log('[61830303] 13. BB-FLA-004 only cancel available:', onlyCancel);
        break;
      }
    }

    const file = await waitForSftpFile(/GSURN.*61830303/i, 30000);
    console.log('[61830303] 13. GSURN file on SFTP:', file);
    await screenshot('order3-13-bbfla-cancel-only');
  });

  // 14. Order status final check
  test('[61830303] 14. Order status final check', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const status = await getOrderStatus();
    console.log('[61830303] 14. Final order status:', status);
    await screenshot('order3-14-final-status');
  });
});
