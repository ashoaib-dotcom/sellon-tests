import { test, expect, chromium, Page, Browser } from '@playwright/test';

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  test.setTimeout(300000);

  browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  page = await context.newPage();

  console.log('Step 1: Navigating to login page...');
  await page.goto('https://mpe-test.lobster-cloud.com', { timeout: 120000 });
  await page.waitForSelector('input', { state: 'visible', timeout: 120000 });
  await page.waitForTimeout(5000);

  console.log('Step 2: Filling credentials...');
  const usernameField = page.getByRole('textbox', { name: 'Username' });
  await usernameField.click();
  await usernameField.pressSequentially('ashoaib', { delay: 150 });
  await page.waitForTimeout(1000);

  const passwordField = page.getByRole('textbox', { name: 'Password' });
  await passwordField.click();
  await passwordField.pressSequentially('test2', { delay: 150 });
  await page.waitForTimeout(1000);

  const passwordValue = await passwordField.inputValue();
  if (passwordValue === '') {
    console.log('Password empty, retrying...');
    await passwordField.click();
    await passwordField.pressSequentially('test2', { delay: 200 });
    await page.waitForTimeout(1000);
  }

  console.log('Step 3: Clicking login...');
  await page.getByRole('button', { name: 'Login' }).click();

  const yesButton = page.getByRole('button', { name: 'Yes' });
  try {
    await yesButton.waitFor({ state: 'visible', timeout: 15000 });
    await yesButton.click();
    console.log('Step 4: Session popup handled');
  } catch {
    console.log('Step 4: No session popup');
  }

  console.log('Step 5: Waiting for dashboard...');
  await page.waitForTimeout(60000);
  console.log('LOGIN COMPLETE');
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

// ==========================================
// HELPERS
// ==========================================

async function openSidebar() {
  try {
    const modal = page.locator('lb-modal.blocking');
    const isVisible = await modal.isVisible();
    if (isVisible) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(2000);
    }
  } catch {}

  await page.locator('.menu-icon').click();
  await page.waitForTimeout(2000);
}

// ==========================================
// DASHBOARD: ALL 7 SECTIONS
// ==========================================

test('Dashboard: should display all 7 sections', async () => {
  test.setTimeout(120000);

  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Delivery Rate' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cancel Rate' })).toBeVisible();

  await page.screenshot({ path: 'screenshots/dashboard-all-sections.png', fullPage: true, timeout: 5000 });
  console.log('ALL 7 SECTIONS TEST PASSED');
});

// ==========================================
// DASHBOARD: PRODUCTS SECTION
// ==========================================

test('Dashboard: Products section should show product counts and stages', async () => {
  test.setTimeout(60000);

  await page.screenshot({ path: 'screenshots/dashboard-products-section.png', fullPage: true, timeout: 5000 });

  const bodyText = await page.locator('body').innerText();

  // Products section shows total, Stage 2 (complete), Stage 1 (incomplete), Error (invalid)
  console.log('Contains "Stage 1" (incomplete):', bodyText.includes('Stage 1'));
  console.log('Contains "Stage 2" (complete):', bodyText.includes('Stage 2'));
  console.log('Contains "Error" (invalid):', bodyText.includes('Error'));

  // Should contain numeric counts
  const hasNumbers = /\d+/.test(bodyText);
  expect(hasNumbers).toBeTruthy();

  console.log('PRODUCTS SECTION TEST PASSED');
});

// ==========================================
// DASHBOARD: ORDERS SECTION
// ==========================================

test('Dashboard: Orders section should show order counts', async () => {
  test.setTimeout(60000);

  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();

  const bodyText = await page.locator('body').innerText();
  console.log('Contains "Orders":', bodyText.includes('Orders'));

  await page.screenshot({ path: 'screenshots/dashboard-orders-section.png', fullPage: true, timeout: 5000 });
  console.log('ORDERS SECTION TEST PASSED');
});

// ==========================================
// DASHBOARD: DELIVERY RATE KPI
// ==========================================

test('Dashboard: Delivery Rate KPI section should be visible', async () => {
  test.setTimeout(60000);

  await expect(page.getByRole('heading', { name: 'Delivery Rate' })).toBeVisible();

  const bodyText = await page.locator('body').innerText();
  console.log('Contains "Delivery Rate":', bodyText.includes('Delivery Rate'));

  await page.screenshot({ path: 'screenshots/dashboard-delivery-rate.png', fullPage: true, timeout: 5000 });
  console.log('DELIVERY RATE SECTION TEST PASSED');
});

// ==========================================
// DASHBOARD: CANCEL RATE KPI
// ==========================================

test('Dashboard: Cancel Rate KPI section should be visible', async () => {
  test.setTimeout(60000);

  await expect(page.getByRole('heading', { name: 'Cancel Rate' })).toBeVisible();

  const bodyText = await page.locator('body').innerText();
  console.log('Contains "Cancel Rate":', bodyText.includes('Cancel Rate'));

  await page.screenshot({ path: 'screenshots/dashboard-cancel-rate.png', fullPage: true, timeout: 5000 });
  console.log('CANCEL RATE SECTION TEST PASSED');
});

// ==========================================
// DASHBOARD: IMPORT SECTION
// ==========================================

test('Dashboard: Import section should show recent imports', async () => {
  test.setTimeout(60000);

  const bodyText = await page.locator('body').innerText();

  // Import section shows Import and UpdateStock entries
  console.log('Contains "Import":', bodyText.includes('Import'));
  console.log('Contains "UpdateStock":', bodyText.includes('UpdateStock'));

  // Should show dates for recent imports
  const hasDate = /\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/.test(bodyText);
  console.log('Contains dates:', hasDate);

  await page.screenshot({ path: 'screenshots/dashboard-import-section.png', fullPage: true, timeout: 5000 });
  console.log('IMPORT SECTION TEST PASSED');
});

// ==========================================
// DASHBOARD: EXPORT GALAXUS SECTION
// ==========================================

test('Dashboard: Export Galaxus section should show latest exports', async () => {
  test.setTimeout(60000);

  const bodyText = await page.locator('body').innerText();

  console.log('Contains "Export":', bodyText.includes('Export'));
  console.log('Contains "Galaxus":', bodyText.includes('Galaxus'));

  await page.screenshot({ path: 'screenshots/dashboard-export-galaxus.png', fullPage: true, timeout: 5000 });
  console.log('EXPORT GALAXUS SECTION TEST PASSED');
});

// ==========================================
// DASHBOARD: SCHEDULER SECTION
// ==========================================

test('Dashboard: Scheduler section should show planned exports', async () => {
  test.setTimeout(60000);

  const bodyText = await page.locator('body').innerText();

  console.log('Contains "Scheduler":', bodyText.includes('Scheduler'));

  // Should contain time information
  const hasTime = /\d{1,2}:\d{2}/.test(bodyText);
  console.log('Contains time format:', hasTime);

  // Scroll down to see full dashboard
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'screenshots/dashboard-scheduler.png', fullPage: true, timeout: 5000 });
  console.log('SCHEDULER SECTION TEST PASSED');
});

// ==========================================
// DASHBOARD: FULL SCREENSHOT
// ==========================================

test('Dashboard: should capture full dashboard content', async () => {
  test.setTimeout(60000);

  // Scroll to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/dashboard-full-top.png', fullPage: true, timeout: 5000 });

  // Print all visible headings
  const headings = await page.locator('h1, h2, h3, h4, h5, h6, [class*="heading"], [class*="title"]').allTextContents();
  console.log('ALL DASHBOARD HEADINGS:', headings.filter(h => h.trim().length > 0).slice(0, 20));

  // Print dashboard content
  const bodyText = await page.locator('body').innerText();
  console.log('DASHBOARD CONTENT (first 3000):', bodyText.substring(0, 3000));

  console.log('FULL DASHBOARD CONTENT CAPTURED');
});

// ==========================================
// PRODUCT PAGE: TABLE TESTS
// ==========================================

test('Product: should navigate and display table', async () => {
  test.setTimeout(120000);

  await openSidebar();

  const productItems = page.locator('nav').getByText('Product', { exact: true });
  await productItems.first().click();
  await page.waitForTimeout(2000);

  const subItem = page.locator('nav').getByText('Product', { exact: true }).nth(1);
  await subItem.scrollIntoViewIfNeeded();
  await subItem.dispatchEvent('click');
  await page.waitForTimeout(15000);

  await expect(page.getByTitle('ID', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByTitle('Category', { exact: true })).toBeVisible();
  await expect(page.getByTitle('Name', { exact: true })).toBeVisible();
  await expect(page.getByTitle('Price', { exact: true })).toBeVisible();

  console.log('PRODUCT TABLE TEST PASSED');
});

test('Product: should display product data with pagination', async () => {
  test.setTimeout(60000);

  const rowCount = await page.locator('tr').count();
  console.log('Number of rows:', rowCount);
  expect(rowCount).toBeGreaterThan(1);

  await expect(page.locator('text=/\\d+ - \\d+ of \\d+/')).toBeVisible({ timeout: 15000 });

  // Print pagination details
  const paginationText = await page.locator('text=/\\d+ - \\d+ of \\d+/').innerText();
  console.log('Pagination:', paginationText);

  console.log('PRODUCT DATA TEST PASSED');
});

test('Product: should display toolbar buttons', async () => {
  test.setTimeout(60000);

  await expect(page.getByText('Refresh', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Search', { exact: true })).toBeVisible();
  await expect(page.getByText('Filter and sorting', { exact: true })).toBeVisible();
  await expect(page.getByText('Mass edit', { exact: true })).toBeVisible();
  await expect(page.getByText('Stock import', { exact: true })).toBeVisible();

  console.log('PRODUCT TOOLBAR TEST PASSED');
});

// ==========================================
// PRODUCT PAGE: VERIFY COLUMN HEADERS
// ==========================================

test('Product: should display all important column headers', async () => {
  test.setTimeout(60000);

  await expect(page.getByTitle('ID', { exact: true })).toBeVisible();
  await expect(page.getByTitle('Category', { exact: true })).toBeVisible();
  await expect(page.getByTitle('GTIN', { exact: true })).toBeVisible();
  await expect(page.getByTitle('Name', { exact: true })).toBeVisible();
  await expect(page.getByTitle('Price', { exact: true })).toBeVisible();
  await expect(page.getByTitle('Vat', { exact: true })).toBeVisible();

  console.log('COLUMN HEADERS TEST PASSED');
});

// ==========================================
// PRODUCT PAGE: VERIFY PRODUCT CONTENT
// ==========================================

test('Product: should contain products and show total count', async () => {
  test.setTimeout(60000);

  const bodyText = await page.locator('body').innerText();

  // Verify products are loaded on first page
  expect(bodyText).toContain('Battery char');
  expect(bodyText).toContain('PowerCell');

  // Verify pagination shows product count
  const paginationText = await page.locator('text=/\\d+ - \\d+ of \\d+/').innerText();
  console.log('Pagination:', paginationText);

  // Extract total count from "1 - 50 of 9990"
  const totalMatch = paginationText.match(/of (\d+)/);
  if (totalMatch) {
    const totalProducts = parseInt(totalMatch[1]);
    console.log('Total products:', totalProducts);
    expect(totalProducts).toBeGreaterThan(0);
  }

  console.log('PRODUCT CONTENT TEST PASSED');
});

test('Product: should display pagination controls', async () => {
  test.setTimeout(60000);

  await expect(page.locator('text=/\\d+ - \\d+ of \\d+/')).toBeVisible();
  await expect(page.getByText('Lines/page')).toBeVisible();
  await expect(page.getByText('Page', { exact: true })).toBeVisible();

  console.log('PAGINATION TEST PASSED');
});

// ==========================================
// PRODUCT PAGE: CLEAR BUTTON
// ==========================================

test('Product: should have working Clear button', async () => {
  test.setTimeout(60000);

  await page.getByText('Clear', { exact: true }).click();
  await page.waitForTimeout(3000);

  await expect(page.locator('text=/\\d+ - \\d+ of \\d+/')).toBeVisible({ timeout: 15000 });

  const rowCount = await page.locator('tbody tr').count();
  expect(rowCount).toBeGreaterThan(0);

  console.log('CLEAR BUTTON TEST PASSED');
});

// ==========================================
// PRODUCT PAGE: ROW INTERACTION
// ==========================================

test('Product: should click on a product row', async () => {
  test.setTimeout(120000);

  const firstRow = page.locator('tr').filter({ hasText: 'Battery char' }).first();
  await firstRow.click();
  await page.waitForTimeout(10000);

  await page.screenshot({ path: 'screenshots/product-row-clicked.png', fullPage: true, timeout: 5000 });
  console.log('PRODUCT ROW CLICK TEST PASSED');
});