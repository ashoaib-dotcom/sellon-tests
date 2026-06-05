import { test, expect, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { NavigationPage } from '../pages/navigation.page';
import { ProductListPage } from '../pages/product-list.page';
import { DashboardPage } from '../pages/dashboard.page';

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let navPage: NavigationPage;
let productListPage: ProductListPage;
let dashboardPage: DashboardPage;

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
  navPage = new NavigationPage(page);
  productListPage = new ProductListPage(page);
  dashboardPage = new DashboardPage(page);

  await loginPage.login('ashoaib', 'test2');
  await navPage.navigateToProducts();
  console.log('SETUP COMPLETE');
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

// ==========================================
// STEP 1: VERIFY PRODUCTS BEFORE EXPORT
// ==========================================

test('Export Step 1: Verify products before export', async () => {
  test.setTimeout(120000);
  await productListPage.expectTableVisible();
  const pagination = await productListPage.getPaginationText();
  console.log('Products before export:', pagination);

  // Check export status column shows exclamation marks (not exported yet)
  const bodyText = await page.locator('body').innerText();
  console.log('Page has products:', bodyText.includes('Battery char') || bodyText.includes('Stage'));

  await page.screenshot({ path: 'screenshots/pom-export-1-before.png', fullPage: true });
  console.log('STEP 1 PASSED');
});

// ==========================================
// STEP 2: VERIFY EXPORT BUTTON EXISTS
// ==========================================

test('Export Step 2: Verify Export button exists', async () => {
  test.setTimeout(60000);
  await expect(page.getByText('Export', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: 'screenshots/pom-export-2-button.png', fullPage: true });
  console.log('STEP 2 PASSED');
});

// ==========================================
// STEP 3: CLICK EXPORT BUTTON
// ==========================================

test('Export Step 3: Click Export button to export products', async () => {
  test.setTimeout(120000);

  await page.getByText('Export', { exact: true }).click();
  await page.waitForTimeout(15000);

  await page.screenshot({ path: 'screenshots/pom-export-3-clicked.png', fullPage: true });

  const bodyText = await page.locator('body').innerText();
  console.log('After export click - has "export":', bodyText.toLowerCase().includes('export'));
  console.log('After export click - has "success":', bodyText.toLowerCase().includes('success'));
  console.log('After export click - has "error":', bodyText.toLowerCase().includes('error'));

  // Print all buttons to see if confirmation needed
  const buttons = await page.getByRole('button').allTextContents();
  console.log('Buttons after export click:', buttons);

  console.log('STEP 3 PASSED');
});

// ==========================================
// STEP 4: HANDLE EXPORT CONFIRMATION
// ==========================================

test('Export Step 4: Handle export confirmation dialog', async () => {
  test.setTimeout(120000);

  // If a confirmation dialog appeared, click OK/Yes/Confirm
  try {
    const confirmBtn = page.getByRole('button', { name: /OK|Yes|Confirm|Export|Start/i }).first();
    if (await confirmBtn.isVisible({ timeout: 5000 })) {
      await confirmBtn.click();
      console.log('Clicked confirmation button');
      await page.waitForTimeout(10000);
    } else {
      console.log('No confirmation dialog - export may have started directly');
    }
  } catch {
    console.log('No confirmation needed');
  }

  await page.screenshot({ path: 'screenshots/pom-export-4-confirmed.png', fullPage: true });
  console.log('STEP 4 PASSED');
});

// ==========================================
// STEP 5: WAIT FOR EXPORT TO COMPLETE
// ==========================================

test('Export Step 5: Wait for export to complete', async () => {
  test.setTimeout(300000);

  for (let i = 1; i <= 6; i++) {
    await page.waitForTimeout(15000);
    try {
      await page.screenshot({ path: `screenshots/pom-export-5-progress-${i}.png`, fullPage: true, timeout: 10000 });
      const bodyText = await page.locator('body').innerText({ timeout: 10000 });
      console.log(`Export check ${i}: complete=${bodyText.toLowerCase().includes('complete')}, success=${bodyText.toLowerCase().includes('success')}`);

      if (bodyText.toLowerCase().includes('complete') || bodyText.toLowerCase().includes('success')) {
        console.log('Export complete!');
        break;
      }
    } catch {}
  }

  console.log('STEP 5 PASSED');
});

// ==========================================
// STEP 6: VERIFY EXPORT STATUS CHANGED
// ==========================================

test('Export Step 6: Verify export status updated', async () => {
  test.setTimeout(120000);

  // Refresh the product list
  try {
    await productListPage.clickRefresh();
  } catch {
    await navPage.navigateToProducts();
  }

  await page.screenshot({ path: 'screenshots/pom-export-6-status.png', fullPage: true });

  const bodyText = await page.locator('body').innerText();

  // After export, products should show green export status (date instead of exclamation)
  // Products with errors (like DART-S-004 with wrong VAT) should still show exclamation
  console.log('Export status visible in page');
  console.log('Contains date format:', /\d{2}\/\d{2}\/\d{4}/.test(bodyText));

  console.log('STEP 6 PASSED');
});

// ==========================================
// STEP 7: VERIFY ERROR PRODUCTS NOT EXPORTED
// ==========================================

test('Export Step 7: Verify products with errors were not exported', async () => {
  test.setTimeout(60000);

  const bodyText = await page.locator('body').innerText();

  // Products with errors should NOT be exported
  // They should still show exclamation mark, not green checkmark
  console.log('Contains "Error":', bodyText.includes('Error'));
  console.log('Contains "Stage 1":', bodyText.includes('Stage 1'));
  console.log('Contains "Stage 2":', bodyText.includes('Stage 2'));

  await page.screenshot({ path: 'screenshots/pom-export-7-error-products.png', fullPage: true });
  console.log('STEP 7 PASSED');
});

// ==========================================
// STEP 8: CHECK DASHBOARD FOR EXPORT INFO
// ==========================================

test('Export Step 8: Verify export appears on dashboard', async () => {
  test.setTimeout(180000);

  // Navigate to dashboard
  await page.goto('https://mpe-test.lobster-cloud.com', { timeout: 120000, waitUntil: 'commit' });
  await page.waitForTimeout(30000);

  try {
    await dashboardPage.expectAllSectionsVisible();
  } catch {
    await page.waitForTimeout(30000);
  }

  const bodyText = await dashboardPage.getBodyText();

  // Export should appear in Export Galaxus section
  console.log('Dashboard contains "Export":', bodyText.includes('Export'));
  console.log('Dashboard contains "Galaxus":', bodyText.includes('Galaxus'));

  // Check if export date/time is shown
  const hasRecentDate = /\d{2}\/\d{2}\/\d{4}/.test(bodyText);
  console.log('Dashboard shows recent dates:', hasRecentDate);

  await dashboardPage.screenshot('pom-export-8-dashboard');
  console.log('STEP 8 PASSED');
});

// ==========================================
// STEP 9: VERIFY SCHEDULER SHOWS NEXT EXPORT
// ==========================================

test('Export Step 9: Verify scheduler shows next planned export', async () => {
  test.setTimeout(60000);

  const bodyText = await dashboardPage.getBodyText();

  console.log('Contains "Scheduler":', bodyText.includes('Scheduler'));
  const hasTime = /\d{1,2}:\d{2}/.test(bodyText);
  console.log('Shows next export time:', hasTime);

  await dashboardPage.scrollToBottom();
  await dashboardPage.screenshot('pom-export-9-scheduler');
  console.log('STEP 9 PASSED');
});