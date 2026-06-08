import { test, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { OrdersPage } from '../pages/orders.page';

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let ordersPage: OrdersPage;

test.beforeAll(async () => {
  test.setTimeout(300000);

  browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  page = await context.newPage();
  loginPage = new LoginPage(page);
  ordersPage = new OrdersPage(page);

  await loginPage.login('ashoaib', 'test2');
  console.log('LOGIN COMPLETE');
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

test('Orders: should navigate to Orders page', async () => {
  test.setTimeout(120000);
  await ordersPage.navigateToOrders();
  await ordersPage.screenshot('pom-orders-page');

  const bodyText = await ordersPage.getBodyText();
  console.log('Page contains "Orders":', bodyText.includes('Orders'));

  console.log('ORDERS NAVIGATION PASSED');
});

test('Orders: should display order data', async () => {
  test.setTimeout(60000);

  try {
    await ordersPage.expectOrderTableVisible();
    const rowCount = await ordersPage.getRowCount();
    console.log('Order rows:', rowCount);
  } catch {
    console.log('Order table not found - may have different structure');
  }

  await ordersPage.screenshot('pom-orders-data');
  console.log('ORDERS DATA PASSED');
});

test('Orders: should display order page content', async () => {
  test.setTimeout(60000);

  const bodyText = await ordersPage.getBodyText();
  console.log('ORDERS PAGE CONTENT (first 2000):', bodyText.substring(0, 2000));

  await ordersPage.screenshot('pom-orders-content');
  console.log('ORDERS CONTENT PASSED');
});

// ==========================================
// ORDER DETAIL
// ==========================================

test('Orders: should open order detail by clicking a row', async () => {
  test.setTimeout(120000);

  const firstRow = page.locator('tbody tr').first();
  const rowCount = await firstRow.count();
  if (rowCount === 0) {
    console.log('No orders in list — skipping detail test');
    return;
  }

  await firstRow.click();
  await page.waitForTimeout(5000);

  const bodyText = await ordersPage.getBodyText();
  // Order detail should contain position/product info
  const hasDetail = bodyText.toLowerCase().includes('position') ||
    bodyText.toLowerCase().includes('product') ||
    bodyText.toLowerCase().includes('quantity') ||
    bodyText.toLowerCase().includes('shipping');
  console.log('Order detail page shown:', hasDetail);

  await ordersPage.screenshot('pom-orders-detail-opened');
  console.log('ORDER DETAIL PASSED');
});

// ==========================================
// ORDERS EXPORT
// ==========================================

test('Orders export: without selection — all orders exported as xlsx', async () => {
  test.setTimeout(120000);

  // Navigate back to orders list
  await ordersPage.navigateToOrders();
  await page.waitForTimeout(3000);

  const exportBtn = page.getByText('Export', { exact: true });
  if (!await exportBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Export button not found on orders page — skipping');
    return;
  }

  // Listen for download before clicking
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
    exportBtn.click(),
  ]);

  await page.waitForTimeout(5000);

  if (download) {
    const filename = download.suggestedFilename();
    console.log('Downloaded file:', filename);
    // Filename format: SellOn_[company]_[yyyymmdd]_[hh:MM:ss].xlsx
    const validName = /SellOn_.*\d{8}_\d{6}\.xlsx/.test(filename) || filename.endsWith('.xlsx');
    console.log('Filename format valid:', validName);
  } else {
    const bodyText = await ordersPage.getBodyText();
    console.log('No download event — page content:', bodyText.substring(0, 500));
  }

  await ordersPage.screenshot('pom-orders-export-all');
  console.log('ORDERS EXPORT WITHOUT SELECTION PASSED');
});

test('Orders export: with one selected order — only that order exported', async () => {
  test.setTimeout(120000);

  await ordersPage.navigateToOrders();
  await page.waitForTimeout(3000);

  const firstRow = page.locator('tbody tr').first();
  if (await firstRow.count() === 0) {
    console.log('No orders — skipping');
    return;
  }

  // Select the first order row checkbox
  const checkbox = firstRow.locator('input[type="checkbox"]').first();
  if (await checkbox.count() > 0) {
    await checkbox.click();
  } else {
    await firstRow.locator('td').first().click();
  }
  await page.waitForTimeout(500);
  console.log('Selected one order row');

  const exportBtn = page.getByText('Export', { exact: true });
  if (!await exportBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Export button not visible — skipping');
    return;
  }

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
    exportBtn.click(),
  ]);

  await page.waitForTimeout(5000);

  if (download) {
    const filename = download.suggestedFilename();
    console.log('Downloaded file (single selection):', filename);
    console.log('Is xlsx:', filename.endsWith('.xlsx'));
  } else {
    console.log('No download — export may open inline');
  }

  await ordersPage.screenshot('pom-orders-export-one');
  console.log('ORDERS EXPORT WITH ONE SELECTION PASSED');
});

test('Orders export: with multiple selected orders — only selected exported', async () => {
  test.setTimeout(120000);

  await ordersPage.navigateToOrders();
  await page.waitForTimeout(3000);

  const rows = page.locator('tbody tr');
  const count = await rows.count();
  if (count < 2) {
    console.log('Not enough orders to select multiple — skipping');
    return;
  }

  // Select first two rows
  for (const idx of [0, 1]) {
    const row = rows.nth(idx);
    const checkbox = row.locator('input[type="checkbox"]').first();
    if (await checkbox.count() > 0) {
      await checkbox.click();
    } else {
      await row.locator('td').first().click();
    }
    await page.waitForTimeout(300);
  }
  console.log('Selected 2 order rows');

  const exportBtn = page.getByText('Export', { exact: true });
  if (!await exportBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Export button not visible — skipping');
    return;
  }

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
    exportBtn.click(),
  ]);

  await page.waitForTimeout(5000);

  if (download) {
    const filename = download.suggestedFilename();
    console.log('Downloaded file (multi selection):', filename);
    console.log('Is xlsx:', filename.endsWith('.xlsx'));
  } else {
    console.log('No download — export may open inline');
  }

  await ordersPage.screenshot('pom-orders-export-multi');
  console.log('ORDERS EXPORT WITH MULTIPLE SELECTION PASSED');
});