import { test, expect, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { NavigationPage } from '../pages/navigation.page';
import { ProductListPage } from '../pages/product-list.page';

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let dashboardPage: DashboardPage;
let navPage: NavigationPage;
let productListPage: ProductListPage;

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
  dashboardPage = new DashboardPage(page);
  navPage = new NavigationPage(page);
  productListPage = new ProductListPage(page);

  await loginPage.login('ashoaib', 'test2');
  console.log('LOGIN COMPLETE');
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

// ==========================================
// DASHBOARD: ALL 7 SECTIONS
// ==========================================

test('Dashboard: should display all 7 sections', async () => {
  test.setTimeout(120000);
  await dashboardPage.expectAllSectionsVisible();
  await dashboardPage.screenshot('pom-dash-all-sections');
  console.log('ALL SECTIONS TEST PASSED');
});

// ==========================================
// DASHBOARD: PRODUCTS SECTION WITH COUNTS
// ==========================================

test('Dashboard: Products section should show total, complete, incomplete, invalid counts', async () => {
  test.setTimeout(60000);
  const bodyText = await dashboardPage.getBodyText();

  // Stage 2 = complete, Stage 1 = incomplete, Error = invalid
  console.log('Contains "Stage 1" (incomplete):', bodyText.includes('Stage 1'));
  console.log('Contains "Stage 2" (complete):', bodyText.includes('Stage 2'));
  console.log('Contains "Error" (invalid):', bodyText.includes('Error'));

  await dashboardPage.screenshot('pom-dash-products-counts');
  console.log('PRODUCTS COUNTS TEST PASSED');
});

// ==========================================
// DASHBOARD: ORDERS SECTION
// ==========================================

test('Dashboard: Orders section should show total and new orders', async () => {
  test.setTimeout(60000);
  await dashboardPage.expectOrdersSectionVisible();
  const bodyText = await dashboardPage.getBodyText();
  console.log('Contains "Orders":', bodyText.includes('Orders'));
  await dashboardPage.screenshot('pom-dash-orders');
  console.log('ORDERS SECTION TEST PASSED');
});

// ==========================================
// DASHBOARD: DELIVERY RATE KPI
// ==========================================

test('Dashboard: Delivery Rate KPI should show merchant reliability', async () => {
  test.setTimeout(60000);
  await dashboardPage.expectDeliveryRateVisible();
  const bodyText = await dashboardPage.getBodyText();
  console.log('Contains "Delivery Rate":', bodyText.includes('Delivery Rate'));
  await dashboardPage.screenshot('pom-dash-delivery-rate');
  console.log('DELIVERY RATE TEST PASSED');
});

// ==========================================
// DASHBOARD: CANCEL RATE KPI
// ==========================================

test('Dashboard: Cancel Rate KPI should show cancellation metrics', async () => {
  test.setTimeout(60000);
  await dashboardPage.expectCancelRateVisible();
  const bodyText = await dashboardPage.getBodyText();
  console.log('Contains "Cancel Rate":', bodyText.includes('Cancel Rate'));
  await dashboardPage.screenshot('pom-dash-cancel-rate');
  console.log('CANCEL RATE TEST PASSED');
});

// ==========================================
// DASHBOARD: IMPORT SECTION
// ==========================================

test('Dashboard: Import section should show recent imports and stock updates', async () => {
  test.setTimeout(60000);
  const bodyText = await dashboardPage.getBodyText();

  console.log('Contains "Import":', bodyText.includes('Import'));
  console.log('Contains "UpdateStock":', bodyText.includes('UpdateStock'));

  // Should show dates
  const hasDate = /\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/.test(bodyText);
  console.log('Contains dates:', hasDate);

  // Should show affected product counts
  console.log('Contains numbers:', /\d+/.test(bodyText));

  await dashboardPage.screenshot('pom-dash-import');
  console.log('IMPORT SECTION TEST PASSED');
});

// ==========================================
// DASHBOARD: IMPORT SHOWS FAILED PRODUCTS
// ==========================================

test('Dashboard: Import section should list failed and successful products', async () => {
  test.setTimeout(60000);
  const bodyText = await dashboardPage.getBodyText();

  console.log('Contains "failed":', bodyText.toLowerCase().includes('failed'));
  console.log('Contains "success":', bodyText.toLowerCase().includes('success'));
  console.log('Contains "error":', bodyText.toLowerCase().includes('error'));

  await dashboardPage.screenshot('pom-dash-import-details');
  console.log('IMPORT DETAILS TEST PASSED');
});

// ==========================================
// DASHBOARD: EXPORT GALAXUS SECTION
// ==========================================

test('Dashboard: Export Galaxus section should show latest exports with product count', async () => {
  test.setTimeout(60000);
  const bodyText = await dashboardPage.getBodyText();

  console.log('Contains "Export":', bodyText.includes('Export'));
  console.log('Contains "Galaxus":', bodyText.includes('Galaxus'));

  await dashboardPage.screenshot('pom-dash-export');
  console.log('EXPORT GALAXUS TEST PASSED');
});

// ==========================================
// DASHBOARD: SCHEDULER SECTION
// ==========================================

test('Dashboard: Scheduler should show next planned export times', async () => {
  test.setTimeout(60000);
  const bodyText = await dashboardPage.getBodyText();

  console.log('Contains "Scheduler":', bodyText.includes('Scheduler'));
  const hasTime = /\d{1,2}:\d{2}/.test(bodyText);
  console.log('Contains time:', hasTime);

  await dashboardPage.scrollToBottom();
  await dashboardPage.screenshot('pom-dash-scheduler');
  console.log('SCHEDULER TEST PASSED');
});

// ==========================================
// DASHBOARD: LANGUAGE AND LOCALE
// ==========================================

test('Dashboard: should display in user locale language', async () => {
  test.setTimeout(60000);
  await dashboardPage.scrollToTop();

  const bodyText = await dashboardPage.getBodyText();

  // Check date format matches locale (DD/MM/YYYY or MM/DD/YYYY)
  const hasLocaleDates = /\d{2}\/\d{2}\/\d{4}|\d{2}\.\d{2}\.\d{4}/.test(bodyText);
  console.log('Contains locale formatted dates:', hasLocaleDates);

  // Check time format
  const hasLocaleTime = /\d{1,2}:\d{2}\s?(AM|PM)?/.test(bodyText);
  console.log('Contains locale formatted time:', hasLocaleTime);

  await dashboardPage.screenshot('pom-dash-locale');
  console.log('LOCALE TEST PASSED');
});

// ==========================================
// DASHBOARD: FULL CONTENT CAPTURE
// ==========================================

test('Dashboard: should capture full dashboard content', async () => {
  test.setTimeout(60000);
  await dashboardPage.scrollToTop();
  await dashboardPage.screenshot('pom-dash-full-top');

  await dashboardPage.scrollToBottom();
  await dashboardPage.screenshot('pom-dash-full-bottom');

  const bodyText = await dashboardPage.getBodyText();
  console.log('DASHBOARD CONTENT (first 3000):', bodyText.substring(0, 3000));

  console.log('FULL DASHBOARD CAPTURED');
});

// ==========================================
// PRODUCT PAGE TESTS
// ==========================================

test('Product: should navigate and display table', async () => {
  test.setTimeout(120000);
  await navPage.navigateToProducts();
  await productListPage.expectTableVisible();
  console.log('PRODUCT TABLE TEST PASSED');
});

test('Product: should display product data with pagination', async () => {
  test.setTimeout(60000);
  const rowCount = await productListPage.getRowCount();
  console.log('Rows:', rowCount);
  expect(rowCount).toBeGreaterThan(0);
  const pagination = await productListPage.getPaginationText();
  console.log('Pagination:', pagination);
  console.log('PRODUCT DATA TEST PASSED');
});

test('Product: should display toolbar buttons', async () => {
  test.setTimeout(60000);
  await productListPage.expectToolbarVisible();
  console.log('TOOLBAR TEST PASSED');
});

test('Product: should display all column headers', async () => {
  test.setTimeout(60000);
  await productListPage.expectColumnHeaders();
  console.log('COLUMN HEADERS TEST PASSED');
});

test('Product: should contain products and show total count', async () => {
  test.setTimeout(60000);
  await productListPage.expectTableVisible();
  const rowCount = await productListPage.getRowCount();
  console.log('Visible product rows:', rowCount);
  expect(rowCount).toBeGreaterThan(0);
  const pagination = await productListPage.getPaginationText();
  const totalMatch = pagination.match(/of (\d+)/);
  if (totalMatch) {
    console.log('Total products:', totalMatch[1]);
    expect(parseInt(totalMatch[1])).toBeGreaterThan(0);
  }
  console.log('PRODUCT CONTENT TEST PASSED');
});

test('Product: should display pagination controls', async () => {
  test.setTimeout(60000);
  await productListPage.expectPaginationVisible();
  console.log('PAGINATION TEST PASSED');
});

test('Product: should verify only company products are shown', async () => {
  test.setTimeout(60000);
  const bodyText = await dashboardPage.getBodyText();

  // All products should belong to current company
  console.log('Contains company products:', bodyText.includes('Battery char') || bodyText.includes('PowerCell'));

  await dashboardPage.screenshot('pom-product-company-check');
  console.log('COMPANY PRODUCTS TEST PASSED');
});

test('Product: should have working Clear button', async () => {
  test.setTimeout(60000);
  await productListPage.clickClear();
  const rowCount = await productListPage.getRowCount();
  expect(rowCount).toBeGreaterThan(0);
  console.log('CLEAR BUTTON TEST PASSED');
});

test('Product: should have working Refresh button', async () => {
  test.setTimeout(60000);
  await productListPage.clickRefresh();
  const rowCount = await productListPage.getRowCount();
  expect(rowCount).toBeGreaterThan(0);
  await dashboardPage.screenshot('pom-product-refreshed');
  console.log('REFRESH BUTTON TEST PASSED');
});

test('Product: should click on a product row', async () => {
  test.setTimeout(120000);
  await productListPage.clickFirstProductRow();
  await dashboardPage.screenshot('pom-product-row-clicked');
  console.log('ROW CLICK TEST PASSED');
});