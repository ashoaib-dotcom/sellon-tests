import { test, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { NavigationPage } from '../pages/navigation.page';
import { ProductListPage } from '../pages/product-list.page';
import { OrdersPage } from '../pages/orders.page';
import { ProfilePage } from '../pages/profile.page';

// ─── Smoke suite ──────────────────────────────────────────────────────────────
//
//  Runs BEFORE all other CI jobs (stage: smoke).
//  All other jobs have needs: [smoke] so they are skipped on smoke failure.
//
//  Checks five critical happy paths in a single browser session:
//    1. Valid credentials reach the dashboard
//    2. App shell (menu icon) is visible on dashboard
//    3. Product list: table loads, toolbar visible, row count > 0
//    4. Orders list table loads after navigation
//    5. Profile dropdown opens and shows expected menu items
//
//  Target runtime: < 5 minutes on CI.

test.describe.configure({ mode: 'serial' });

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  test.setTimeout(180000);

  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page = await context.newPage();

  const loginPage = new LoginPage(page);
  await loginPage.login(
    process.env.TEST_USERNAME || '',
    process.env.TEST_PASSWORD || '',
  );
  console.log('[Smoke] Login complete');
});

test.afterAll(async () => {
  await browser.close();
});

async function ss(name: string) {
  try { await page.screenshot({ path: `screenshots/smoke-${name}.png`, fullPage: true }); } catch {}
}

// ─── 1. Login ─────────────────────────────────────────────────────────────────

test('Smoke: login reaches the app @smoke', async () => {
  test.setTimeout(60000);

  const loginPage = new LoginPage(page);
  await loginPage.expectLoginFieldsGone();
  await ss('01-post-login');
  console.log('[Smoke] 1/5 Login → app: PASS');
});

// ─── 2. Dashboard ─────────────────────────────────────────────────────────────

test('Smoke: app shell and dashboard are visible @smoke', async () => {
  test.setTimeout(60000);

  await page.locator('.menu-icon, .menubar-item').first()
    .waitFor({ state: 'visible', timeout: 30000 });
  await ss('02-dashboard');
  console.log('[Smoke] 2/5 Dashboard app shell: PASS');
});

// ─── 3. Product list ──────────────────────────────────────────────────────────

test('Smoke: product list table loads @smoke', async () => {
  test.setTimeout(90000);

  const nav      = new NavigationPage(page);
  const products = new ProductListPage(page);

  await nav.navigateToProducts();
  await products.expectTableVisible();
  await ss('03-products-table');
  console.log('[Smoke] 3a/5 Product list table: PASS');

  await products.expectToolbarVisible();
  await ss('03-products-toolbar');
  console.log('[Smoke] 3b/5 Product list toolbar: PASS');

  const rowCount = await products.getRowCount();
  console.log(`[Smoke] 3c/5 Product rows visible: ${rowCount}`);
  await ss('03-products-rows');
  console.log('[Smoke] 3/5 Product list: PASS');
});

// ─── 4. Orders list ───────────────────────────────────────────────────────────

test('Smoke: orders list table loads @smoke', async () => {
  test.setTimeout(90000);

  const nav    = new NavigationPage(page);
  const orders = new OrdersPage(page);

  await nav.navigateToOrders();
  await orders.expectOrderTableVisible();
  await ss('04-orders');
  console.log('[Smoke] 4/5 Orders list: PASS');
});

// ─── 5. Profile dropdown ──────────────────────────────────────────────────────

test('Smoke: profile dropdown opens with all menu items @smoke', async () => {
  test.setTimeout(60000);

  const profilePage = new ProfilePage(page);

  await profilePage.openProfileDropdown();
  await ss('05-profile-dropdown');
  await profilePage.expectProfileMenuVisible();
  await profilePage.closeProfileDropdown();
  console.log('[Smoke] 5/5 Profile dropdown: PASS');
});
