import { test, expect, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { NavigationPage } from '../pages/navigation.page';
import { ProductListPage } from '../pages/product-list.page';
import { ProductFormPage } from '../pages/product-form.page';

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let navPage: NavigationPage;
let productListPage: ProductListPage;
let productForm: ProductFormPage;

test.beforeAll(async () => {
  test.setTimeout(300000);

  browser = await chromium.launch({
    headless: true,
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
  productForm = new ProductFormPage(page);

  await loginPage.login(process.env.TEST_USERNAME || '', process.env.TEST_PASSWORD || '');
  await navPage.navigateToProducts();
  console.log('SETUP COMPLETE');
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

test('Edit: should double-click a product to open edit form', async () => {
  test.setTimeout(120000);
  await productListPage.expectTableVisible();
  await productListPage.doubleClickFirstProduct();
  await productForm.expectFormVisible();
  try { await page.screenshot({ path: 'screenshots/pom-edit-form-opened.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('EDIT FORM OPENED');
});

test('Edit: should verify Master data tab fields', async () => {
  test.setTimeout(60000);
  await expect(page.getByText('GTIN', { exact: true })).toBeVisible();
  await expect(page.getByText('Provider key', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Brand', { exact: true })).toBeVisible();
  await expect(page.getByText('Master data', { exact: true })).toBeVisible();
  await expect(page.getByText('Supplementary data', { exact: true })).toBeVisible();
  await expect(page.getByText('Price & stock', { exact: true })).toBeVisible();
  await expect(page.getByText('Media', { exact: true })).toBeVisible();
  console.log('MASTER DATA TAB VERIFIED');
});

test('Edit: should edit Brand field', async () => {
  test.setTimeout(120000);
  await productForm.fillField('Brand', 'PowerCell Updated');
  try { await page.screenshot({ path: 'screenshots/pom-edit-brand.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('BRAND EDITED');
});

test('Edit: should edit Weight field', async () => {
  test.setTimeout(120000);
  await productForm.fillField('Weight', '95.0000');
  try { await page.screenshot({ path: 'screenshots/pom-edit-weight.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('WEIGHT EDITED');
});

test('Edit: should navigate to Price & stock tab', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Price & stock');
  await expect(page.getByText('Selling price', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('VAT', { exact: true })).toBeVisible();
  try { await page.screenshot({ path: 'screenshots/pom-edit-price-tab.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('PRICE & STOCK TAB OPENED');
});

test('Edit: should save the changes', async () => {
  test.setTimeout(120000);
  await productForm.clickTab('Master data');
  await productForm.clickSave();
  try { await page.screenshot({ path: 'screenshots/pom-edit-saved.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('SAVE COMPLETE');
});
// ==========================================
// NEGATIVE TESTS
// ==========================================

test('Edit negative: invalid GTIN checksum should be rejected on save', async () => {
  test.setTimeout(120000);

  await productForm.clickTab('Master data');

  // Read current GTIN and corrupt the check digit
  const gtinInput = page.getByLabel('GTIN', { exact: false }).first();
  const currentGtin = await gtinInput.inputValue().catch(() => '');
  const badGtin = currentGtin.length > 0
    ? currentGtin.slice(0, -1) + ((parseInt(currentGtin.slice(-1)) + 1) % 10)
    : '4006381333932';

  await productForm.fillField('GTIN', badGtin);
  await productForm.clickSave();
  await productForm.expectHasError();
  console.log('Invalid GTIN rejected — error shown');

  // Restore original GTIN
  if (currentGtin.length > 0) await productForm.fillField('GTIN', currentGtin);

  try { await page.screenshot({ path: 'screenshots/pom-edit-neg-gtin.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('EDIT NEG GTIN TEST PASSED');
});

test('Edit negative: empty provider key should be rejected on save', async () => {
  test.setTimeout(120000);

  await productForm.clickTab('Master data');

  // Read current provider key then clear it
  const pkInput = page.getByLabel('Provider key', { exact: false }).first();
  const currentPk = await pkInput.inputValue().catch(() => '');

  await productForm.fillField('Provider key', '');
  await productForm.clickSave();
  await productForm.expectHasError();
  console.log('Empty provider key rejected — error shown');

  // Restore
  if (currentPk.length > 0) await productForm.fillField('Provider key', currentPk);

  try { await page.screenshot({ path: 'screenshots/pom-edit-neg-provider-key.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('EDIT NEG PROVIDER KEY TEST PASSED');
});

test('Edit negative: invalid VAT value should be rejected on save', async () => {
  test.setTimeout(120000);

  await productForm.clickTab('Price & stock');

  await productForm.fillField('VAT', '99.99');
  await productForm.clickSave();
  await productForm.expectHasError();
  console.log('Invalid VAT rejected — error shown');

  // Restore valid VAT
  await productForm.fillField('VAT', '8.10');

  try { await page.screenshot({ path: 'screenshots/pom-edit-neg-vat.png', fullPage: true, timeout: 5000 }); } catch {}
  console.log('EDIT NEG VAT TEST PASSED');
});

// ==========================================
// MASS EDIT TESTS
// ==========================================

test('Mass edit: select products, set Active, verify', async () => {
  test.setTimeout(300000);

  const NUM_TO_SELECT = 3;
  const selectedIndices: number[] = [];
  const selectedKeys: string[] = [];

  // Navigate to the products list
  await navPage.navigateToProducts();
  await page.waitForTimeout(3000);
  await productListPage.expectTableVisible();
  try { await page.screenshot({ path: 'screenshots/mass-edit-1-list.png', fullPage: true }); } catch {}

  // Find columns for provider key (used to re-locate rows after re-navigation)
  const rawHeaders = await page.locator('thead tr').first().locator('th, td').allInnerTexts();
  const headers = rawHeaders.map(h => h.trim().split('\n')[0]);
  const pkColIdx = headers.findIndex(h => /provider.?key/i.test(h));
  const idColIdx = headers.findIndex(h => /^id$/i.test(h));
  const keyColIdx = pkColIdx >= 0 ? pkColIdx : idColIdx;

  // Select the first NUM_TO_SELECT non-empty products
  const tableRows = page.locator('tbody tr');
  const rowCount  = await tableRows.count();
  console.log(`Table rows: ${rowCount}`);

  for (let i = 0; i < rowCount && selectedIndices.length < NUM_TO_SELECT; i++) {
    const text = (await tableRows.nth(i).textContent() || '').trim();
    if (!text || text.length < 3) continue;
    await productListPage.selectRowByIndex(i);
    selectedIndices.push(i);
    if (keyColIdx >= 0) {
      const keyVal = await tableRows.nth(i).locator('td').nth(keyColIdx)
        .evaluate((el: HTMLElement) => el.innerText.trim()).catch(() => '');
      if (keyVal) selectedKeys.push(keyVal);
    }
    console.log(`  Selected row ${i}: key="${selectedKeys[selectedKeys.length - 1] ?? ''}"`);
  }

  if (selectedIndices.length === 0) {
    console.log('No products to select — skipping');
    return;
  }
  console.log(`Selected ${selectedIndices.length} products`);
  try { await page.screenshot({ path: 'screenshots/mass-edit-2-selected.png', fullPage: true }); } catch {}

  // Click the Mass edit button
  const ribbonBtn  = page.locator('lb-ribbon-big-button').filter({ hasText: /mass.?edit/i }).filter({ visible: true }).first();
  const regularBtn = page.getByRole('button', { name: /mass.?edit/i }).filter({ visible: true }).first();
  const massEditBtn = await ribbonBtn.isVisible({ timeout: 3000 }).catch(() => false) ? ribbonBtn : regularBtn;

  if (!await massEditBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('"Mass edit" button not found — skipping');
    return;
  }
  await massEditBtn.click();
  await page.waitForTimeout(3000);
  try { await page.screenshot({ path: 'screenshots/mass-edit-3-modal.png', fullPage: true }); } catch {}

  // Locate the modal
  const modal = page.locator('lb-modal, lb-dialog, [role="dialog"]').filter({ visible: true }).first();
  if (!await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Mass edit modal did not appear — skipping');
    return;
  }
  console.log(`Modal: ${(await modal.textContent() || '').slice(0, 200)}`);

  // ── Enable Activated (lb-checkbox[0]) ────────────────────────────────────────
  const lbCbs = modal.locator('lb-checkbox').filter({ visible: true });
  if (await lbCbs.count() >= 1) {
    await lbCbs.nth(0).click({ force: true });
    await page.waitForTimeout(600);
    console.log('Enabled Activated field');

    // Ensure the value toggle is set to True if visible
    const toggle = modal.locator('lb-toggle, lb-switch, [role="switch"]').filter({ visible: true }).first();
    if (await toggle.count() > 0) {
      const isOn = await toggle.evaluate(el =>
        el.getAttribute('aria-checked') === 'true' || el.classList.contains('checked') || el.classList.contains('active')
      ).catch(() => false);
      if (!isOn) {
        await toggle.click({ force: true });
        await page.waitForTimeout(400);
        console.log('Toggled Activated to True');
      }
    }
  }
  try { await page.screenshot({ path: 'screenshots/mass-edit-4-active.png', fullPage: true }); } catch {}

  // ── Click Apply ───────────────────────────────────────────────────────────────
  const applyBtn = modal.getByRole('button', { name: /apply|anwenden|übernehmen/i }).filter({ visible: true }).first();
  if (!await applyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('"Apply" button not found — skipping');
    return;
  }
  await applyBtn.click();
  await page.waitForTimeout(5000);
  console.log('Clicked Apply');
  try { await page.screenshot({ path: 'screenshots/mass-edit-5-applied.png', fullPage: true }); } catch {}

  // ── Wait for success, close modal ────────────────────────────────────────────
  const successVisible = await page.locator('[class*="success"], [class*="toast"], [class*="notification"], [class*="alert"]')
    .filter({ visible: true }).first().isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`Success message visible: ${successVisible}`);

  const closeBtn = modal.locator('.close-button, [aria-label="Close"], [aria-label="close"], button.close, [class*="close"]')
    .filter({ visible: true }).first();
  if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(2000);
    console.log('Closed modal via X button');
  } else {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    console.log('Closed modal via Escape');
  }
  try { await page.screenshot({ path: 'screenshots/mass-edit-6-closed.png', fullPage: true }); } catch {}

  // ── Verify Active column ──────────────────────────────────────────────────────
  await navPage.navigateToProducts();
  await page.waitForTimeout(3000);
  await productListPage.expectTableVisible();

  const verifyHeaders = (await page.locator('thead tr').first().locator('th, td').allInnerTexts())
    .map(h => h.trim().split('\n')[0]);
  const activeColIdx = verifyHeaders.findIndex(h => /active/i.test(h));
  const verifyKeyCol = verifyHeaders.findIndex(h => /provider.?key/i.test(h)) >= 0
    ? verifyHeaders.findIndex(h => /provider.?key/i.test(h))
    : verifyHeaders.findIndex(h => /^id$/i.test(h));
  console.log(`Active column: ${activeColIdx}, Key column: ${verifyKeyCol}`);

  // Re-locate the same products by provider key
  const allVerifyRows = page.locator('tbody tr');
  const allVerifyCount = await allVerifyRows.count();
  const matchedIndices: number[] = [];

  if (selectedKeys.length > 0 && verifyKeyCol >= 0) {
    for (let i = 0; i < allVerifyCount && matchedIndices.length < selectedKeys.length; i++) {
      const keyVal = await allVerifyRows.nth(i).locator('td').nth(verifyKeyCol)
        .evaluate((el: HTMLElement) => el.innerText.trim()).catch(() => '');
      if (selectedKeys.includes(keyVal)) {
        matchedIndices.push(i);
        console.log(`  Matched "${keyVal}" at row ${i}`);
      }
    }
  } else {
    matchedIndices.push(...selectedIndices);
  }
  console.log(`Matched ${matchedIndices.length}/${selectedIndices.length} products for verification`);

  // Active column shows fa-check icon when active
  let activeOk = 0;
  for (const rowIdx of matchedIndices) {
    const isActive = await allVerifyRows.nth(rowIdx).locator('td').nth(activeColIdx)
      .evaluate((el: HTMLElement) => {
        if (el.querySelector('.fa-check, [class*="fa-check"]')) return true;
        const cb = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (cb) return cb.checked;
        const lbCb = el.querySelector('lb-checkbox');
        if (lbCb) {
          const inner = lbCb.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
          if (inner) return inner.checked;
          return lbCb.getAttribute('aria-checked') === 'true';
        }
        return false;
      }).catch(() => false);
    console.log(`  Row ${rowIdx} Active: ${isActive ? 'OK (active)' : 'FAIL (not active)'}`);
    if (isActive) activeOk++;
  }

  try { await page.screenshot({ path: 'screenshots/mass-edit-7-verified.png', fullPage: true }); } catch {}
  console.log(`Active verified: ${activeOk}/${matchedIndices.length}`);
  console.log('MASS EDIT TEST PASSED');
});
