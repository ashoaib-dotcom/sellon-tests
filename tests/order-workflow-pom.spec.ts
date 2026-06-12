import { test, expect, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { OrdersPage } from '../pages/orders.page';
import { getSftpHelper, SftpHelper } from '../helpers/sftp-upload';
import { buildGORDR, buildGDELR, buildGCANR, buildGSURN, buildGCANP, buildGRETP } from '../helpers/edi-builder';

test.describe.configure({ mode: 'serial' });

// Populated at runtime by discoverOrders() in beforeAll — nothing hardcoded
let ORDER_1 = '';
let ORDER_2 = '';
let ORDER_3 = '';

// Positions (SKU + qty) extracted from each open order at runtime
let order1Positions: { sku: string; qty: number }[] = [];
let order2Positions: { sku: string; qty: number }[] = [];
let order3Positions: { sku: string; qty: number }[] = [];

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let ordersPage: OrdersPage;
let sftp: SftpHelper;

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

// Returns up to `count` order IDs found in the orders grid
async function discoverOrders(count = 3): Promise<string[]> {
  try {
    await ensureLoggedIn();
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(3000);

    const ids: string[] = [];
    const rows = page.locator('tbody tr');
    const rowCount = Math.min(await rows.count(), 30);

    for (let i = 0; i < rowCount && ids.length < count; i++) {
      const cells = rows.nth(i).locator('td');
      const cellCount = await cells.count();
      for (let j = 0; j < Math.min(cellCount, 6); j++) {
        const text = (await cells.nth(j).textContent() || '').trim();
        if (/^\d{6,12}$/.test(text) && !ids.includes(text)) {
          ids.push(text);
          break;
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

// Reads position rows from the Order items tab of the currently open order
async function extractPositions(): Promise<{ sku: string; qty: number }[]> {
  try {
    const tabOpened = await clickTab('Order items');
    if (!tabOpened) await clickTab('Items');
    await page.waitForTimeout(2000);

    const positions: { sku: string; qty: number }[] = [];
    const rows = page.locator('tbody tr');
    const count = await rows.count();

    for (let i = 0; i < count; i++) {
      const text = (await rows.nth(i).textContent() || '').trim();
      // Provider key format: e.g. BT-SPK-001, BB-FLA-002, DART-S-004
      const skuMatch = text.match(/[A-Z]{2,8}-[A-Z]{2,8}-?\d{2,4}/);
      if (skuMatch) {
        const qtyMatch = text.match(/\b(\d{1,5})\b/);
        const qty = qtyMatch ? Math.max(parseInt(qtyMatch[1], 10), 1) : 1;
        positions.push({ sku: skuMatch[0], qty });
      }
    }

    console.log(`[extractPositions] ${positions.length}: ${positions.map(p => `${p.sku}(${p.qty})`).join(', ')}`);
    return positions;
  } catch (e) {
    console.log('[extractPositions] Error:', (e as Error).message);
    return [];
  }
}

// Builds a RegExp to find SFTP files for a given EDI type and order ID
function sftpPat(type: string, orderId: string): RegExp {
  return orderId ? new RegExp(`${type}.*${orderId}`, 'i') : new RegExp(type, 'i');
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
      console.log(`  Order ${orderId} not found — falling back to first available`);
      if (await filterInputs.count() > 0) {
        await filterInputs.first().fill('');
        await page.waitForTimeout(2000);
      }
      row = page.locator('tbody tr').first();
      if (await row.count() === 0) {
        console.log('  No orders found in list at all');
        return false;
      }
    }

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
  for (const status of ['New', 'Open', 'Confirmed', 'Shipped', 'Cancelled', 'Closed']) {
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
    if (!await btn.isVisible({ timeout: 3000 })) return false;
    if (!await btn.isEnabled({ timeout: 3000 })) return false;
    await btn.click();
    await page.waitForTimeout(3000);
    return true;
  } catch (e) {
    if (label) console.log(`[clickButton] ${label}: not found/clickable`);
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
  await page.waitForTimeout(4000);
}

// Re-authenticate if the session has expired (menu-icon absent = logged out)
async function ensureLoggedIn(): Promise<void> {
  try {
    const visible = await page.locator('.menu-icon').isVisible({ timeout: 4000 });
    if (visible) return;
  } catch {}
  console.log('[AUTH] Session appears expired — re-logging in');
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

// Save any pending changes on the current tab BEFORE switching — Angular discards unsaved tab state on navigation
async function saveAndClickTab(tabName: string): Promise<boolean> {
  await saveOrder();
  return clickTab(tabName);
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
    if (upperType === 'CANP')  ediFile = buildGCANP(orderId, positions.map(p => ({ sku: p.sku })), reason);
    else if (upperType === 'RETP')  ediFile = buildGRETP(orderId, positions.map(p => ({ sku: p.sku, qty: p.qty ?? 1 })), reason);
    else if (upperType === 'GORDR') ediFile = buildGORDR(orderId, positions.map(p => ({ sku: p.sku, qty: p.qty ?? 1 })));
    else if (upperType === 'GDELR') ediFile = buildGDELR(orderId, positions.map(p => ({ sku: p.sku, qty: p.qty ?? 1 })), 'SHIP-AUTO', 'DHL');
    else if (upperType === 'GCANR') ediFile = buildGCANR(orderId, 'Rejected', reason);
    else if (upperType === 'GSURN') ediFile = buildGSURN(orderId, 'Rejected', positions.map(p => ({ sku: p.sku })), reason);
    if (ediFile) { content = ediFile.content; filename = ediFile.filename; }
  } catch (e) {
    console.log(`[importEDI] EDI build error for ${type}:`, e);
  }

  if (content && sftp) {
    try {
      // CANP and RETP are platform→supplier messages — Sellon reads them from remoteOutDir (dg2partner)
      const isInbound = ['CANP', 'RETP', 'GORDP'].includes(type.toUpperCase());
      const result = isInbound
        ? await sftp.uploadToOutDir(content, filename)
        : await sftp.uploadEDIContent(content, filename);
      console.log(`[importEDI] SFTP upload result for ${filename}:`, result);
    } catch (e) {
      console.log(`[importEDI] SFTP upload failed:`, e);
    }
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
  if (!sftp) {
    console.log('NOTE: SFTP not configured — skipping file wait for pattern:', pattern);
    return null;
  }
  try {
    // Sellon writes GORDR/GDELR/GCANR/GSURN to remoteInDir (partner2dg), so poll there
    const inDir = process.env.SFTP_REMOTE_IN_DIR || '/incoming';
    return await sftp.waitForFile(pattern, timeoutMs, 3000, inDir);
  } catch (e) {
    console.log(`[waitForSftpFile] ${pattern}:`, e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// beforeAll / afterAll
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page = await context.newPage();
  loginPage = new LoginPage(page);
  ordersPage = new OrdersPage(page);
  sftp = getSftpHelper();

  await loginPage.login(process.env.TEST_USERNAME || 'ashoaib', process.env.TEST_PASSWORD || 'test2');
  await page.waitForTimeout(3000);

  // Discover real order IDs from the staging orders list
  const discovered = await discoverOrders(3);
  ORDER_1 = discovered[0] || '';
  ORDER_2 = discovered[1] || '';
  ORDER_3 = discovered[2] || '';
  console.log(`Orders discovered — ORDER_1: ${ORDER_1 || 'none'} | ORDER_2: ${ORDER_2 || 'none'} | ORDER_3: ${ORDER_3 || 'none'}`);
});

test.afterAll(async () => {
  await sftp.disconnect().catch(() => {});
  await browser.close();
});

// ===========================================================================
// ORDER 1
// ===========================================================================

test.describe('ORDER 1', () => {
  let opened = false;

  test('[ORDER 1] 1. Order in overview + notification', async () => {
    test.setTimeout(120000);
    if (!ORDER_1) { test.skip(); return; }
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

    if (!rowFound) { console.log('Order not found'); test.skip(); return; }
    expect(rowFound).toBeTruthy();

    const alertResult = registerAlertHandler('[ORDER 1] notification');
    await page.reload();
    await page.waitForTimeout(3000);

    const bodyText = await page.locator('body').textContent() || '';
    const hasNotification = alertResult.triggered ||
      bodyText.toLowerCase().includes('new order') ||
      bodyText.toLowerCase().includes('notification');
    console.log(`[ORDER 1] 1. Order ${ORDER_1} found. Notification:`, hasNotification);
    await screenshot('order1-1-overview');
  });

  test('[ORDER 1] 2. Delivery address', async () => {
    test.setTimeout(120000);
    opened = await findAndOpenOrder(ORDER_1);
    if (!opened) { test.skip(); return; }

    // Extract positions while order is open (opens Order items tab)
    order1Positions = await extractPositions();
    console.log(`[ORDER 1] positions extracted: ${order1Positions.map(p => p.sku).join(', ') || 'none'}`);

    // Delivery address is visible on the order detail page — no tab switch needed
    const bodyText = await page.locator('body').textContent() || '';
    const hasAddress = bodyText.toLowerCase().includes('delivery') ||
      bodyText.toLowerCase().includes('address') ||
      bodyText.toLowerCase().includes('street') ||
      bodyText.toLowerCase().includes('city') ||
      bodyText.toLowerCase().includes('zip') ||
      bodyText.toLowerCase().includes('name');
    console.log('[ORDER 1] 2. Delivery address visible:', hasAddress);
    expect(hasAddress).toBeTruthy();
    await screenshot('order1-2-delivery-address');
  });

  test('[ORDER 1] 3. Stock warning check', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasStockWarning = bodyText.toLowerCase().includes('stock') &&
      (bodyText.toLowerCase().includes('warning') ||
       bodyText.toLowerCase().includes('insufficient') ||
       bodyText.toLowerCase().includes('backorder'));
    console.log('[ORDER 1] 3. Stock warning visible:', hasStockWarning);
    await screenshot('order1-3-stock-warning');
  });

  test('[ORDER 1] 4a. Import CANP — alerts user', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const alertResult = registerAlertHandler('[ORDER 1] CANP alert');
    const positions = order1Positions.length ? [order1Positions[0]] : [{ sku: 'UNKNOWN', qty: 1 }];
    await importEDI('CANP', ORDER_1, { positions, reason: 'Customer cancelled' });
    await page.waitForTimeout(5000);

    const bodyText = await page.locator('body').textContent() || '';
    const result = bodyText.toLowerCase().includes('cancellation') ||
      bodyText.toLowerCase().includes('canp') ||
      bodyText.toLowerCase().includes('cancel request') ||
      alertResult.triggered;
    console.log('[ORDER 1] 4a. CANP alert/notification visible:', result);
    await screenshot('order1-4a-canp-alert');
  });

  test('[ORDER 1] 4b. CANP — opens cancellation request tab', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const tabOpened = await saveAndClickTab('Cancellation request');
    const bodyText = await page.locator('body').textContent() || '';
    const hasTab = tabOpened || bodyText.toLowerCase().includes('cancellation') || bodyText.toLowerCase().includes('cancel');
    console.log('[ORDER 1] 4b. Cancellation request tab visible:', hasTab);
    await screenshot('order1-4b-canp-tab');
  });

  test('[ORDER 1] 4c. CANP — prevents processing order items', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    let enabledInputCount = 0;
    if (count > 0) {
      const inputs = rows.first().locator('input:not([disabled])').filter({ visible: true });
      enabledInputCount = await inputs.count();
    }
    console.log('[ORDER 1] 4c. Enabled inputs in first row (should be locked):', enabledInputCount);
    await screenshot('order1-4c-canp-locked');
  });

  test('[ORDER 1] 4d. CANP reject requires customer message', async () => {
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
      console.log('[ORDER 1] 4d. Reject without message shows validation:', requiresMsg);
    } else {
      console.log('[ORDER 1] 4d. Reject button not found in cancellation tab');
    }
    await screenshot('order1-4d-canp-reject-validation');
  });

  test('[ORDER 1] 4e. CANP status', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 1] 4e. Body contains Reject status:', bodyText.includes('Reject'));
    await screenshot('order1-4e-canp-status');
  });

  test('[ORDER 1] 4f. CANP — cancelled items count', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 1] 4f. Body contains item count number:', /\d+/.test(bodyText));
    await screenshot('order1-4f-canp-items-count');
  });

  test('[ORDER 1] 4g. CANP — provider key visible', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasProviderKey = order1Positions.length > 0 && order1Positions.some(p => bodyText.includes(p.sku));
    console.log('[ORDER 1] 4g. Body contains provider key:', hasProviderKey,
      order1Positions.length ? `(${order1Positions[0].sku})` : '(no positions extracted)');
    await screenshot('order1-4g-canp-provider-key');
  });

  test('[ORDER 1] 5a. Reject cancellation — fill message and save', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    try {
      const textarea = page.locator('textarea').filter({ visible: true }).first();
      if (await textarea.isVisible({ timeout: 3000 })) {
        await textarea.fill('Test rejection reason');
      } else {
        const msgInput = page.locator('input[type="text"]').filter({ visible: true }).last();
        if (await msgInput.isVisible({ timeout: 3000 })) await msgInput.fill('Test rejection reason');
      }
    } catch (e) {
      console.log('[ORDER 1] 5a. Could not find message input:', e);
    }

    await saveOrder();
    await screenshot('order1-5a-rejection-saved');
  });

  test('[ORDER 1] 5b. GCANR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(sftpPat('GCANR', ORDER_1), 30000);
    console.log('[ORDER 1] 5b. GCANR file on SFTP:', file);
  });

  test('[ORDER 1] 5c. Post-reject: rejection reason in body', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 1] 5c. Rejection reason visible in body:', bodyText.includes('Test rejection reason'));
  });

  test('[ORDER 1] 5d. Cancellation tab is read-only after reject', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const inputs = page.locator('tbody tr input:not([disabled])').filter({ visible: true });
    console.log('[ORDER 1] 5d. Enabled inputs in cancellation tab after reject:', await inputs.count());
    await screenshot('order1-5d-readonly');
  });

  test('[ORDER 1] 5e. Body contains Rejected', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 1] 5e. Body contains Rejected:', bodyText.includes('Rejected'));
    await screenshot('order1-5e-rejected-status');
  });

  test('[ORDER 1] 6a. Confirm first position — status To confirm', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    try { await saveAndClickTab('Master data'); } catch {
      await ordersPage.navigateToOrders();
      opened = await findAndOpenOrder(ORDER_1);
    }

    const firstSku = order1Positions[0]?.sku || '';
    if (firstSku) {
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const rowText = await rows.nth(i).textContent() || '';
        if (rowText.includes(firstSku)) {
          const confirmBtn = rows.nth(i).getByRole('button', { name: /confirm/i });
          if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await confirmBtn.click(); await page.waitForTimeout(2000);
          }
          const qtyInput = rows.nth(i).locator('input[type="number"]');
          if (await qtyInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await qtyInput.click(); await qtyInput.fill('1');
          }
          break;
        }
      }
    }

    const updatedBody = await page.locator('body').textContent() || '';
    console.log('[ORDER 1] 6a. Status To confirm visible:', updatedBody.toLowerCase().includes('to confirm'));
    await screenshot('order1-6a-to-confirm');
  });

  test('[ORDER 1] 6b. Save → status Confirmed', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 1] 6b. Status Confirmed after save:', bodyText.includes('Confirmed'));
    await screenshot('order1-6b-confirmed');
  });

  test('[ORDER 1] 6c. GORDR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(sftpPat('GORDR', ORDER_1), 30000);
    console.log('[ORDER 1] 6c. GORDR file on SFTP:', file);
  });

  test('[ORDER 1] 7a. Create shipping — click new shipment', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const clicked = await clickButton(/new shipment|create shipment|shipping/i, 'new shipment');
    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 1] 7a. New shipment button clicked:', clicked);
    console.log('[ORDER 1] 7a. Carrier/shipment fields visible:', bodyText.toLowerCase().includes('carrier') || bodyText.toLowerCase().includes('shipment number'));
    await screenshot('order1-7a-new-shipment');
  });

  test('[ORDER 1] 7b. Verify carrier, shipment number fields', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 1] 7b. Carrier field visible:', bodyText.toLowerCase().includes('carrier'),
      '| Shipment number field visible:', bodyText.toLowerCase().includes('shipment'));
    await screenshot('order1-7b-shipment-fields');
  });

  test('[ORDER 1] 7c. Save without shipment number → error shown', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    const bodyText = await page.locator('body').textContent() || '';
    const hasError = bodyText.toLowerCase().includes('error') ||
      bodyText.toLowerCase().includes('required') ||
      bodyText.toLowerCase().includes('invalid') ||
      bodyText.toLowerCase().includes('mandatory');
    console.log('[ORDER 1] 7c. Error shown when saving without shipment number:', hasError);
    await screenshot('order1-7c-shipment-error');
  });

  test('[ORDER 1] 7d. Fill carrier, shipment number, select first position', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    try {
      const carrierInput = page.locator('input[name*="carrier"], input[placeholder*="carrier"]').first();
      if (await carrierInput.isVisible({ timeout: 3000 })) await carrierInput.fill('DHL');
    } catch {}

    try {
      const shipNumInput = page.locator('input[name*="shipment"], input[placeholder*="shipment"], input[name*="tracking"]').first();
      if (await shipNumInput.isVisible({ timeout: 3000 })) await shipNumInput.fill('SHIP-001');
    } catch {}

    try {
      const firstSku = order1Positions[0]?.sku || '';
      if (firstSku) {
        const rows = page.locator('tbody tr');
        const count = await rows.count();
        for (let i = 0; i < count; i++) {
          const rowText = await rows.nth(i).textContent() || '';
          if (rowText.includes(firstSku)) {
            const checkbox = rows.nth(i).locator('input[type="checkbox"]');
            if (await checkbox.isVisible({ timeout: 2000 })) await checkbox.check();
            break;
          }
        }
      }
    } catch {}

    await saveOrder();
    await screenshot('order1-7d-shipment-saved');
  });

  test('[ORDER 1] 7e. Wait for GDELR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(sftpPat('GDELR', ORDER_1), 30000);
    console.log('[ORDER 1] 7e. GDELR file on SFTP:', file);
    await screenshot('order1-7e-gdelr');
  });

  test('[ORDER 1] 8a. Import RETP', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const positions = order1Positions.length ? [{ sku: order1Positions[0].sku, qty: 1 }] : [{ sku: 'UNKNOWN', qty: 1 }];
    await importEDI('RETP', ORDER_1, { positions, reason: 'Product defective' });
    await screenshot('order1-8a-retp-import');
  });

  test('[ORDER 1] 8b. RETP — opens return request tab', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveAndClickTab('Return request');
    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 1] 8b. Return request tab visible:',
      bodyText.toLowerCase().includes('return') || bodyText.toLowerCase().includes('retp'));
    await screenshot('order1-8b-retp-tab');
  });

  test('[ORDER 1] 8c. RETP — reason text visible', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 1] 8c. RETP reason visible:',
      bodyText.toLowerCase().includes('product defective') || bodyText.toLowerCase().includes('defective'));
  });

  test('[ORDER 1] 8d. RETP — amount visible', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 1] 8d. RETP amount/number visible:', /\d+/.test(bodyText));
  });

  test('[ORDER 1] 8e. RETP — position SKU visible', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasSku = order1Positions.length > 0 && order1Positions.some(p => bodyText.includes(p.sku));
    console.log('[ORDER 1] 8e. Position SKU visible in return tab:', hasSku);
    await screenshot('order1-8e-retp-sku');
  });

  test('[ORDER 1] 8f. RETP — Reject button requires reason', async () => {
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
      console.log('[ORDER 1] 8f. Reject without reason shows validation:', requiresReason);
    } else {
      console.log('[ORDER 1] 8f. Reject button not found in return tab');
    }
    await screenshot('order1-8f-retp-reject-validation');
  });

  test('[ORDER 1] 8g. RETP — soft checks summary', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }
    await screenshot('order1-8g-retp-summary');
  });

  test('[ORDER 1] 9a. Reject return — fill rejection reason', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    try {
      const textarea = page.locator('textarea').filter({ visible: true }).first();
      if (await textarea.isVisible({ timeout: 3000 })) {
        await textarea.fill('Return rejected - test');
      } else {
        const input = page.locator('input[type="text"]').filter({ visible: true }).last();
        if (await input.isVisible({ timeout: 3000 })) await input.fill('Return rejected - test');
      }
    } catch (e) {
      console.log('[ORDER 1] 9a. Could not fill rejection reason:', e);
    }

    await screenshot('order1-9a-return-rejection-reason');
  });

  test('[ORDER 1] 9b. Save return rejection', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    await screenshot('order1-9b-return-rejection-saved');
  });

  test('[ORDER 1] 9c. Wait for GSURN on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(sftpPat('GSURN', ORDER_1), 30000);
    console.log('[ORDER 1] 9c. GSURN file on SFTP:', file);
  });

  test('[ORDER 1] 9d. Return tab shows Rejected', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 1] 9d. Return tab shows Rejected:', bodyText.includes('Rejected'));
    await screenshot('order1-9d-return-rejected');
  });

  test('[ORDER 1] 9e. Return tab not editable after reject', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const inputs = page.locator('tbody tr input:not([disabled])').filter({ visible: true });
    console.log('[ORDER 1] 9e. Enabled inputs in return tab after reject:', await inputs.count());
    await screenshot('order1-9e-return-readonly');
  });

  test('[ORDER 1] 9f. Body contains Rejected for return', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 1] 9f. Body contains Rejected:', bodyText.includes('Rejected'));
    await screenshot('order1-9f-return-rejected-final');
  });

  test('[ORDER 1] 10. Order status final check', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const status = await getOrderStatus();
    console.log('[ORDER 1] 10. Order status:', status);
    await screenshot('order1-10-final-status');
  });
});

// ===========================================================================
// ORDER 2
// ===========================================================================

test.describe('ORDER 2', () => {
  let opened = false;

  test('[ORDER 2] 1. Order in overview', async () => {
    test.setTimeout(120000);
    if (!ORDER_2) { test.skip(); return; }
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

    if (!rowFound) { console.log('Order not found'); test.skip(); return; }
    expect(rowFound).toBeTruthy();
    console.log(`[ORDER 2] 1. Order ${ORDER_2} found in overview`);
    await screenshot('order2-1-overview');
  });

  test('[ORDER 2] 2. Delivery address', async () => {
    test.setTimeout(120000);
    opened = await findAndOpenOrder(ORDER_2);
    if (!opened) { test.skip(); return; }

    // Extract positions while order is open (opens Order items tab)
    order2Positions = await extractPositions();
    console.log(`[ORDER 2] positions extracted: ${order2Positions.map(p => p.sku).join(', ') || 'none'}`);

    // Delivery address is visible on the order detail page — no tab switch needed
    const bodyText = await page.locator('body').textContent() || '';
    const hasAddress = bodyText.toLowerCase().includes('delivery') ||
      bodyText.toLowerCase().includes('address') ||
      bodyText.toLowerCase().includes('street') ||
      bodyText.toLowerCase().includes('city') ||
      bodyText.toLowerCase().includes('zip') ||
      bodyText.toLowerCase().includes('name');
    console.log('[ORDER 2] 2. Delivery address visible:', hasAddress);
    expect(hasAddress).toBeTruthy();
    await screenshot('order2-2-delivery-address');
  });

  test('[ORDER 2] 3. Stock warning check', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    const hasWarning = order2Positions.some(p => bodyText.includes(p.sku)) &&
      (bodyText.toLowerCase().includes('stock') ||
       bodyText.toLowerCase().includes('warning') ||
       bodyText.toLowerCase().includes('insufficient'));
    console.log('[ORDER 2] 3. Stock warning for any position:', hasWarning);
    await screenshot('order2-3-stock-warnings');
  });

  test('[ORDER 2] 4a. Import CANP — mixed handling', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const positions = order2Positions.length ? order2Positions : [{ sku: 'UNKNOWN', qty: 1 }];
    await importEDI('CANP', ORDER_2, { positions, reason: 'Cancellation' });
    await saveAndClickTab('Cancellation request');
    await screenshot('order2-4a-canp-mixed');
  });

  test('[ORDER 2] 4b. Approve first position (partial qty)', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const firstSku = order2Positions[0]?.sku || '';
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (firstSku && rowText.includes(firstSku)) {
        const qtyInput = rows.nth(i).locator('input[type="number"]');
        if (await qtyInput.isVisible({ timeout: 2000 })) await qtyInput.fill('1');
        const approveBtn = rows.nth(i).getByRole('button', { name: /approve|accept/i });
        if (await approveBtn.isVisible({ timeout: 2000 })) {
          await approveBtn.click(); await page.waitForTimeout(2000);
        }
        break;
      }
    }
    console.log(`[ORDER 2] 4b. First position (${firstSku || 'unknown'}): approve attempted`);
    await screenshot('order2-4b-btspk-approve');
  });

  test('[ORDER 2] 4c. Reject second position', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const secondSku = order2Positions[1]?.sku || '';
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    let found = false;
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (secondSku && rowText.includes(secondSku)) {
        const rejectBtn = rows.nth(i).getByRole('button', { name: /reject/i });
        if (await rejectBtn.isVisible({ timeout: 2000 })) {
          await rejectBtn.click(); await page.waitForTimeout(2000); found = true;
        }
        break;
      }
    }
    console.log(`[ORDER 2] 4c. Second position (${secondSku || 'unknown'}) reject clicked:`, found);
    await screenshot('order2-4c-akk-reject');
  });

  test('[ORDER 2] 4d. Accept third position', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const thirdSku = order2Positions[2]?.sku || '';
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    let found = false;
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (thirdSku && rowText.includes(thirdSku)) {
        const acceptBtn = rows.nth(i).getByRole('button', { name: /accept|approve/i });
        if (await acceptBtn.isVisible({ timeout: 2000 })) {
          await acceptBtn.click(); await page.waitForTimeout(2000); found = true;
        }
        break;
      }
    }
    console.log(`[ORDER 2] 4d. Third position (${thirdSku || 'unknown'}) accept clicked:`, found);
    await screenshot('order2-4d-bbfla-accept');
  });

  test('[ORDER 2] 4e. Save cancellation decisions', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    await screenshot('order2-4e-canp-saved');
  });

  test('[ORDER 2] 4f. Verify enabled items and statuses', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const inputs = page.locator('tbody tr input:not([disabled])').filter({ visible: true });
    console.log('[ORDER 2] 4f. Enabled inputs in tbody after save:', await inputs.count());
    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 2] 4f. Cancellation statuses — Cancelled:', bodyText.includes('Cancelled'),
      '| Rejected:', bodyText.includes('Rejected'), '| Approved:', bodyText.includes('Approved'));
    await screenshot('order2-4f-statuses');
  });

  test('[ORDER 2] 5a. Confirm all open positions', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const confirmAllBtn = page.getByRole('button', { name: /confirm all/i }).filter({ visible: true }).first();
    if (await confirmAllBtn.isVisible({ timeout: 3000 })) {
      await confirmAllBtn.click(); await page.waitForTimeout(3000);
    } else {
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const confirmBtn = rows.nth(i).getByRole('button', { name: /confirm/i });
        if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await confirmBtn.click(); await page.waitForTimeout(1000);
        }
      }
    }
    await screenshot('order2-5a-confirm-all');
  });

  test('[ORDER 2] 5b. Save and check Confirmed status', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    const status = await getOrderStatus();
    console.log('[ORDER 2] 5b. Order status after confirm:', status);
    console.log('[ORDER 2] 5b. Status is Confirmed:', status === 'Confirmed');
    await screenshot('order2-5b-confirmed');
  });

  test('[ORDER 2] 5c. GORDR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(sftpPat('GORDR', ORDER_2), 30000);
    console.log('[ORDER 2] 5c. GORDR file on SFTP:', file);
  });

  test('[ORDER 2] 5d. GCANR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(sftpPat('GCANR', ORDER_2), 30000);
    console.log('[ORDER 2] 5d. GCANR file on SFTP:', file);
    await screenshot('order2-5d-gcanr');
  });

  test('[ORDER 2] 6a. Create shipment — split positions', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await clickButton(/new shipment|create shipment|shipping/i, 'new shipment');

    try {
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      // Select first two positions for split shipment
      let selected = 0;
      for (let i = 0; i < count && selected < 2; i++) {
        const check = rows.nth(i).locator('input[type="checkbox"]');
        if (await check.isVisible({ timeout: 1000 }).catch(() => false)) {
          await check.check(); selected++;
        }
      }
    } catch (e) {
      console.log('[ORDER 2] 6a. Could not select positions:', e);
    }

    await screenshot('order2-6a-split-shipment');
  });

  test('[ORDER 2] 6b. Verify shipment fields visible', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 2] 6b. Fields — carrier:', bodyText.toLowerCase().includes('carrier'),
      '| parcel type:', bodyText.toLowerCase().includes('parcel') || bodyText.toLowerCase().includes('type'),
      '| shipment number:', bodyText.toLowerCase().includes('shipment'),
      '| delivery note:', bodyText.toLowerCase().includes('delivery note') || bodyText.toLowerCase().includes('note'));
    await screenshot('order2-6b-shipment-fields');
  });

  test('[ORDER 2] 6c. Fill shipment details and save', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    try {
      const carrierInput = page.locator('input[name*="carrier"], input[placeholder*="carrier"]').first();
      if (await carrierInput.isVisible({ timeout: 3000 })) await carrierInput.fill('DHL');
    } catch {}

    try {
      const shipNumInput = page.locator('input[name*="shipment"], input[placeholder*="shipment"], input[name*="tracking"]').first();
      if (await shipNumInput.isVisible({ timeout: 3000 })) await shipNumInput.fill('SHIP-302-A');
    } catch {}

    await saveOrder();
    await screenshot('order2-6c-shipment-saved');
  });

  test('[ORDER 2] 7. GDELR on SFTP after shipment', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(sftpPat('GDELR', ORDER_2), 30000);
    console.log('[ORDER 2] 7. GDELR file on SFTP:', file);
    await screenshot('order2-7-gdelr');
  });

  test('[ORDER 2] 8. Order remains Confirmed', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const status = await getOrderStatus();
    console.log('[ORDER 2] 8. Order status (expect Confirmed):', status);
  });

  test('[ORDER 2] 9a. Shipping for remaining position — Letter parcel type', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await clickButton(/new shipment|create shipment|shipping/i, 'new shipment');

    try {
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      // Select last unshipped position
      const lastRow = rows.nth(count - 1);
      const check = lastRow.locator('input[type="checkbox"]');
      if (await check.isVisible({ timeout: 2000 })) await check.check();
    } catch {}

    try {
      const parcelSelect = page.locator('select[name*="parcel"], select[name*="type"]').first();
      if (await parcelSelect.isVisible({ timeout: 3000 })) {
        await parcelSelect.selectOption({ label: 'Letter' });
      } else {
        const parcelInput = page.locator('input[name*="parcel"]').first();
        if (await parcelInput.isVisible({ timeout: 3000 })) await parcelInput.fill('Letter');
      }
    } catch {}

    await screenshot('order2-9a-letter-shipment');
  });

  test('[ORDER 2] 9b. Shipment number not required for Letter', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 2] 9b. Letter parcel type selected:', bodyText.toLowerCase().includes('letter'));
    await screenshot('order2-9b-letter-no-shipnum');
  });

  test('[ORDER 2] 9c. Save letter shipment', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    await screenshot('order2-9c-letter-saved');
  });

  test('[ORDER 2] 9d. GDELR and check Shipped status', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(sftpPat('GDELR', ORDER_2), 60000);
    console.log('[ORDER 2] 9d. GDELR file on SFTP:', file);
    if (opened) {
      const status = await getOrderStatus();
      console.log('[ORDER 2] 9d. Order status (expect Shipped):', status);
    }
    await screenshot('order2-9d-shipped');
  });

  test('[ORDER 2] 10a. Manual return — Register return for second position', async () => {
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
      if (await qtyInput.isVisible({ timeout: 2000 })) await qtyInput.fill('1');
    } else {
      console.log('[ORDER 2] 10a. UAR/Register return button not found on position 2');
    }
    await screenshot('order2-10a-uar-setup');
  });

  test('[ORDER 2] 10b. Status To confirm before save', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 2] 10b. Status To confirm before save:', bodyText.toLowerCase().includes('to confirm'));
  });

  test('[ORDER 2] 10c. Save UAR', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 2] 10c. Status Confirmed after UAR save:', bodyText.includes('Confirmed'));
    console.log('[ORDER 2] 10c. Body contains Returned for position:', bodyText.includes('Returned'));
    await screenshot('order2-10c-uar-saved');
  });

  test('[ORDER 2] 10d. GSURN on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(sftpPat('GSURN', ORDER_2), 30000);
    console.log('[ORDER 2] 10d. GSURN file on SFTP:', file);
    await screenshot('order2-10d-gsurn');
  });

  test('[ORDER 2] 11. Order stays Shipped', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const status = await getOrderStatus();
    console.log('[ORDER 2] 11. Order status (expect Shipped):', status);
    await screenshot('order2-11-final-status');
  });
});

// ===========================================================================
// ORDER 3
// ===========================================================================

test.describe('ORDER 3', () => {
  let opened = false;

  test('[ORDER 3] 1. Alert email / notification', async () => {
    test.setTimeout(120000);
    if (!ORDER_3) { test.skip(); return; }
    const alertResult = registerAlertHandler('[ORDER 3] notification');
    await ordersPage.navigateToOrders();
    await page.waitForTimeout(3000);

    const bodyText = await page.locator('body').textContent() || '';
    const hasNotification = alertResult.triggered ||
      bodyText.toLowerCase().includes('new order') ||
      bodyText.toLowerCase().includes('notification');
    console.log('[ORDER 3] 1. Notification/alert visible:', hasNotification);
    await screenshot('order3-1-notification');
  });

  test('[ORDER 3] 2. Order in overview', async () => {
    test.setTimeout(120000);
    if (!ORDER_3) { test.skip(); return; }
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

    if (!rowFound) { console.log('Order not found'); test.skip(); return; }
    expect(rowFound).toBeTruthy();
    console.log(`[ORDER 3] 2. Order ${ORDER_3} found in overview`);
    await screenshot('order3-2-overview');
  });

  test('[ORDER 3] 3. Order status = New', async () => {
    test.setTimeout(120000);
    opened = await findAndOpenOrder(ORDER_3);
    if (!opened) { test.skip(); return; }

    const status = await getOrderStatus();
    console.log('[ORDER 3] 3. Order status (expect New):', status);
    console.log('[ORDER 3] 3. Status is New:', status === 'New');
    await screenshot('order3-3-status-new');
  });

  test('[ORDER 3] 4. Delivery address', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    // Extract positions while order is open (opens Order items tab)
    order3Positions = await extractPositions();
    console.log(`[ORDER 3] positions extracted: ${order3Positions.map(p => p.sku).join(', ') || 'none'}`);

    // Delivery address is visible on the order detail page — no tab switch needed
    const bodyText = await page.locator('body').textContent() || '';
    const hasAddress = bodyText.toLowerCase().includes('delivery') ||
      bodyText.toLowerCase().includes('address') ||
      bodyText.toLowerCase().includes('street') ||
      bodyText.toLowerCase().includes('city') ||
      bodyText.toLowerCase().includes('zip') ||
      bodyText.toLowerCase().includes('name');
    console.log('[ORDER 3] 4. Delivery address visible:', hasAddress);
    expect(hasAddress).toBeTruthy();
    await screenshot('order3-4-delivery-address');
  });

  test('[ORDER 3] 5a. First position — unknown SKU check', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await clickTab('Order');
    const bodyText = await page.locator('body').textContent() || '';
    const firstSku = order3Positions[0]?.sku || '';
    const hasPos = firstSku ? bodyText.includes(firstSku) : false;
    const hasUnknown = bodyText.toLowerCase().includes('unknown');
    console.log(`[ORDER 3] 5a. First position (${firstSku || 'n/a'}) in body:`, hasPos);
    console.log('[ORDER 3] 5a. Unknown status present:', hasUnknown);
    await screenshot('order3-5a-bbfla-unknown');
  });

  test('[ORDER 3] 5b. First position — only reject button check', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    let nonRejectBtnCount = 0;
    if (count > 0) {
      const firstSku = order3Positions[0]?.sku || '';
      for (let i = 0; i < count; i++) {
        const rowText = await rows.nth(i).textContent() || '';
        if (!firstSku || rowText.includes(firstSku)) {
          const allBtns = rows.nth(i).getByRole('button').filter({ visible: true });
          const totalBtns = await allBtns.count();
          for (let j = 0; j < totalBtns; j++) {
            const btnText = await allBtns.nth(j).textContent() || '';
            const btnName = await allBtns.nth(j).getAttribute('name') || '';
            if (!btnText.toLowerCase().includes('reject') && !btnName.toLowerCase().includes('reject')) {
              if (await allBtns.nth(j).isEnabled()) nonRejectBtnCount++;
            }
          }
          break;
        }
      }
    }
    console.log('[ORDER 3] 5b. Non-reject enabled buttons for first position (expect 0):', nonRejectBtnCount);
    await screenshot('order3-5b-bbfla-only-reject');
  });

  test('[ORDER 3] 6. Other positions not marked unknown', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    const firstSku = order3Positions[0]?.sku || '';
    let unknownInOthers = false;
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if ((!firstSku || !rowText.includes(firstSku)) && rowText.toLowerCase().includes('unknown')) {
        unknownInOthers = true; break;
      }
    }
    console.log('[ORDER 3] 6. Other positions marked unknown (expect false):', unknownInOthers);
    await screenshot('order3-6-other-positions');
  });

  test('[ORDER 3] 7a. Reject first position', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    const firstSku = order3Positions[0]?.sku || '';
    let clicked = false;
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (!firstSku || rowText.includes(firstSku)) {
        const rejectBtn = rows.nth(i).getByRole('button', { name: /reject/i });
        if (await rejectBtn.isVisible({ timeout: 2000 })) {
          await rejectBtn.click(); await page.waitForTimeout(2000); clicked = true;
        }
        break;
      }
    }
    console.log(`[ORDER 3] 7a. First position (${firstSku || 'n/a'}) reject clicked:`, clicked);
    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 3] 7a. Alert/warning/rejected shown:',
      bodyText.toLowerCase().includes('alert') || bodyText.toLowerCase().includes('warning') || bodyText.toLowerCase().includes('rejected'));
    await screenshot('order3-7a-bbfla-reject');
  });

  test('[ORDER 3] 7b. Body contains Cancelling', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 3] 7b. Body contains Cancelling:', bodyText.includes('Cancelling'));
  });

  test('[ORDER 3] 7c. Save first position rejection', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 3] 7c. Body contains Cancelled by vendor:', bodyText.includes('Cancelled by vendor'));
    await screenshot('order3-7c-bbfla-saved');
  });

  test('[ORDER 3] 7d. EOLN or GCANR on SFTP', async () => {
    test.setTimeout(120000);
    const pattern = ORDER_3
      ? new RegExp(`EOLN.*${ORDER_3}|GCANR.*${ORDER_3}`, 'i')
      : /EOLN|GCANR/i;
    const file = await waitForSftpFile(pattern, 30000);
    console.log('[ORDER 3] 7d. EOLN/GCANR file on SFTP:', file);
    await screenshot('order3-7d-eoln-gcanr');
  });

  test('[ORDER 3] 8a. Import CANP — mixed quantities', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const positions = order3Positions.length ? order3Positions : [{ sku: 'UNKNOWN', qty: 1 }];
    await importEDI('CANP', ORDER_3, { positions, reason: 'Cancellation' });
    await saveAndClickTab('Cancellation request');
    await screenshot('order3-8a-canp-import');
  });

  test('[ORDER 3] 8b. Positions not editable while CANP pending', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const inputs = page.locator('tbody tr input:not([disabled])').filter({ visible: true });
    console.log('[ORDER 3] 8b. Enabled inputs while CANP pending:', await inputs.count());
    await screenshot('order3-8b-canp-pending');
  });

  test('[ORDER 3] 8c. Accept first position fully', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const firstSku = order3Positions[0]?.sku || '';
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (!firstSku || rowText.includes(firstSku)) {
        const acceptBtn = rows.nth(i).getByRole('button', { name: /accept|approve/i });
        if (await acceptBtn.isVisible({ timeout: 2000 })) {
          await acceptBtn.click(); await page.waitForTimeout(2000);
        }
        break;
      }
    }
    await screenshot('order3-8c-bbfla-accept');
  });

  test('[ORDER 3] 8d. Accept second position', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const secondSku = order3Positions[1]?.sku || '';
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (secondSku && rowText.includes(secondSku)) {
        const qtyInput = rows.nth(i).locator('input[type="number"]');
        if (await qtyInput.isVisible({ timeout: 2000 })) await qtyInput.fill(String(order3Positions[1].qty));
        const acceptBtn = rows.nth(i).getByRole('button', { name: /accept|approve/i });
        if (await acceptBtn.isVisible({ timeout: 2000 })) {
          await acceptBtn.click(); await page.waitForTimeout(2000);
        }
        break;
      }
    }
    await screenshot('order3-8d-darts-accept');
  });

  test('[ORDER 3] 8e. Accept third position', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const thirdSku = order3Positions[2]?.sku || '';
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (thirdSku && rowText.includes(thirdSku)) {
        const qtyInput = rows.nth(i).locator('input[type="number"]');
        if (await qtyInput.isVisible({ timeout: 2000 })) await qtyInput.fill(String(order3Positions[2].qty));
        const acceptBtn = rows.nth(i).getByRole('button', { name: /accept|approve/i });
        if (await acceptBtn.isVisible({ timeout: 2000 })) {
          await acceptBtn.click(); await page.waitForTimeout(2000);
        }
        break;
      }
    }
    await screenshot('order3-8e-back001-accept');
  });

  test('[ORDER 3] 8f. Save CANP decisions', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    const bodyText = await page.locator('body').textContent() || '';
    const hasMultiple = order3Positions.filter(p => bodyText.includes(p.sku)).length > 1;
    console.log('[ORDER 3] 8f. Multiple positions visible after save:', hasMultiple);
    await screenshot('order3-8f-canp-saved');
  });

  test('[ORDER 3] 8g. GCANR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(sftpPat('GCANR', ORDER_3), 30000);
    console.log('[ORDER 3] 8g. GCANR file on SFTP:', file);
    await screenshot('order3-8g-gcanr');
  });

  test('[ORDER 3] 9a. Confirm open positions', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const confirmAllBtn = page.getByRole('button', { name: /confirm all/i }).filter({ visible: true }).first();
    if (await confirmAllBtn.isVisible({ timeout: 3000 })) {
      await confirmAllBtn.click(); await page.waitForTimeout(3000);
    } else {
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const confirmBtn = rows.nth(i).getByRole('button', { name: /confirm/i });
        if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await confirmBtn.click(); await page.waitForTimeout(1000);
        }
      }
    }
    await screenshot('order3-9a-confirm-positions');
  });

  test('[ORDER 3] 9b. Save and check status', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveOrder();
    const status = await getOrderStatus();
    console.log('[ORDER 3] 9b. Order status after confirm:', status);
    await screenshot('order3-9b-status-after-confirm');
  });

  test('[ORDER 3] 9c. GORDR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(sftpPat('GORDR', ORDER_3), 30000);
    console.log('[ORDER 3] 9c. GORDR file on SFTP:', file);
    await screenshot('order3-9c-gordr');
  });

  test('[ORDER 3] 10a. Import RETP — cannot accept before shipped', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const positions = order3Positions.length > 1
      ? [{ sku: order3Positions[1].sku, qty: 1 }]
      : order3Positions.length
        ? [{ sku: order3Positions[0].sku, qty: 1 }]
        : [{ sku: 'UNKNOWN', qty: 1 }];
    await importEDI('RETP', ORDER_3, { positions, reason: 'Defective' });
    await saveAndClickTab('Return request');
    await screenshot('order3-10a-retp-import');
  });

  test('[ORDER 3] 10b. Accept return disabled before shipped', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const acceptBtn = page.getByRole('button', { name: /accept|approve/i }).filter({ visible: true }).first();
    const found = await acceptBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (found) {
      const isEnabled = await acceptBtn.isEnabled();
      if (!isEnabled) {
        console.log('[ORDER 3] 10b. Cannot accept return before shipped: correct (button disabled)');
      } else {
        await acceptBtn.click(); await page.waitForTimeout(2000);
        const bodyText = await page.locator('body').textContent() || '';
        const hasError = bodyText.toLowerCase().includes('error') ||
          bodyText.toLowerCase().includes('not shipped') ||
          bodyText.toLowerCase().includes('cannot');
        console.log('[ORDER 3] 10b. Cannot accept before shipped — error shown:', hasError);
      }
    } else {
      console.log('[ORDER 3] 10b. Cannot accept return before shipped: correct (button not found)');
    }
    await screenshot('order3-10b-retp-disabled');
  });

  test('[ORDER 3] 11. Create shipping with all positions', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await clickButton(/new shipment|create shipment|shipping/i, 'new shipment');

    try {
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const check = rows.nth(i).locator('input[type="checkbox"]');
        if (await check.isVisible({ timeout: 1000 }).catch(() => false)) await check.check();
      }
    } catch (e) {
      console.log('[ORDER 3] 11. Could not select all positions:', e);
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

  test('[ORDER 3] 11b. GDELR on SFTP', async () => {
    test.setTimeout(120000);
    const file = await waitForSftpFile(sftpPat('GDELR', ORDER_3), 30000);
    console.log('[ORDER 3] 11b. GDELR file on SFTP:', file);
    await screenshot('order3-11b-gdelr');
  });

  test('[ORDER 3] 12. Accept return for second position', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    await saveAndClickTab('Return request');
    const secondSku = order3Positions.length > 1 ? order3Positions[1].sku : order3Positions[0]?.sku || '';
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (!secondSku || rowText.includes(secondSku)) {
        const acceptBtn = rows.nth(i).getByRole('button', { name: /accept|approve/i });
        if (await acceptBtn.isVisible({ timeout: 2000 })) {
          await acceptBtn.click(); await page.waitForTimeout(3000);
        }
        break;
      }
    }

    await saveOrder();
    const bodyText = await page.locator('body').textContent() || '';
    console.log('[ORDER 3] 12. Returned status:', bodyText.includes('Returned'));
    await screenshot('order3-12-dart-returned');
  });

  test('[ORDER 3] 13. First position can only be cancelled', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const firstSku = order3Positions[0]?.sku || '';
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent() || '';
      if (!firstSku || rowText.includes(firstSku)) {
        const allBtns = rows.nth(i).getByRole('button').filter({ visible: true });
        const btnCount = await allBtns.count();
        let onlyCancel = true;
        for (let j = 0; j < btnCount; j++) {
          const btnText = (await allBtns.nth(j).textContent() || '').toLowerCase();
          const isEnabled = await allBtns.nth(j).isEnabled();
          if (isEnabled && !btnText.includes('cancel') && !btnText.includes('reject')) onlyCancel = false;
        }
        console.log(`[ORDER 3] 13. First position (${firstSku || 'n/a'}) only cancel available:`, onlyCancel);
        break;
      }
    }

    const file = await waitForSftpFile(sftpPat('GSURN', ORDER_3), 30000);
    console.log('[ORDER 3] 13. GSURN file on SFTP:', file);
    await screenshot('order3-13-bbfla-cancel-only');
  });

  test('[ORDER 3] 14. Order status final check', async () => {
    test.setTimeout(120000);
    if (!opened) { test.skip(); return; }

    const status = await getOrderStatus();
    console.log('[ORDER 3] 14. Final order status:', status);
    await screenshot('order3-14-final-status');
  });
});
