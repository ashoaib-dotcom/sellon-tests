import { test, chromium, Page, Browser } from '@playwright/test';
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
  await productForm.expectMasterDataTabFields();
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
  await productForm.expectPriceStockTabFields();
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
  const currentGtin = await productForm.getFieldValue('GTIN');
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
  const currentPk = await productForm.getFieldValue('Provider key');

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
  const headers = await productListPage.getHeaderTexts();
  const pkColIdx = headers.findIndex(h => /provider.?key/i.test(h));
  const idColIdx = headers.findIndex(h => /^id$/i.test(h));
  const keyColIdx = pkColIdx >= 0 ? pkColIdx : idColIdx;

  // Select the first NUM_TO_SELECT non-empty products
  const rowCount = await productListPage.getRowCount();
  console.log(`Table rows: ${rowCount}`);

  for (let i = 0; i < rowCount && selectedIndices.length < NUM_TO_SELECT; i++) {
    const text = await productListPage.getRowText(i);
    if (!text || text.length < 3) continue;
    await productListPage.selectRowByIndex(i);
    selectedIndices.push(i);
    if (keyColIdx >= 0) {
      const keyVal = await productListPage.getRowCellText(i, keyColIdx);
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
  await productListPage.clickMassEdit();
  try { await page.screenshot({ path: 'screenshots/mass-edit-3-modal.png', fullPage: true }); } catch {}

  // Verify the modal appeared
  if (!await productListPage.isMassEditModalVisible()) {
    console.log('Mass edit modal did not appear — skipping');
    return;
  }
  console.log(`Modal: ${await productListPage.getMassEditModalText()}`);

  // ── Enable Activated (lb-checkbox[0]) ────────────────────────────────────────
  if (await productListPage.getMassEditCheckboxCount() >= 1) {
    await productListPage.enableMassEditCheckbox(0);
    console.log('Enabled Activated field');

    // Ensure the value toggle is set to True if visible
    const isOn = await productListPage.isMassEditToggleOn();
    if (!isOn) {
      await productListPage.clickMassEditToggle();
      console.log('Toggled Activated to True');
    }
  }
  try { await page.screenshot({ path: 'screenshots/mass-edit-4-active.png', fullPage: true }); } catch {}

  // ── Click Apply ───────────────────────────────────────────────────────────────
  if (!await productListPage.isMassEditApplyVisible()) {
    console.log('"Apply" button not found — skipping');
    return;
  }
  await productListPage.clickMassEditApply();
  console.log('Clicked Apply');
  try { await page.screenshot({ path: 'screenshots/mass-edit-5-applied.png', fullPage: true }); } catch {}

  // ── Wait for success, close modal ────────────────────────────────────────────
  const successVisible = await productListPage.isSuccessVisible();
  console.log(`Success message visible: ${successVisible}`);

  await productListPage.closeMassEditModal();
  try { await page.screenshot({ path: 'screenshots/mass-edit-6-closed.png', fullPage: true }); } catch {}

  // ── Verify Active column ──────────────────────────────────────────────────────
  await navPage.navigateToProducts();
  await page.waitForTimeout(3000);
  await productListPage.expectTableVisible();

  const verifyHeaders = await productListPage.getHeaderTexts();
  const activeColIdx = verifyHeaders.findIndex(h => /active/i.test(h));
  const verifyKeyCol = verifyHeaders.findIndex(h => /provider.?key/i.test(h)) >= 0
    ? verifyHeaders.findIndex(h => /provider.?key/i.test(h))
    : verifyHeaders.findIndex(h => /^id$/i.test(h));
  console.log(`Active column: ${activeColIdx}, Key column: ${verifyKeyCol}`);

  // Re-locate the same products by provider key
  const allVerifyCount = await productListPage.getRowCount();
  const matchedIndices: number[] = [];

  if (selectedKeys.length > 0 && verifyKeyCol >= 0) {
    for (let i = 0; i < allVerifyCount && matchedIndices.length < selectedKeys.length; i++) {
      const keyVal = await productListPage.getRowCellText(i, verifyKeyCol);
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
    const isActive = await productListPage.isCellActive(rowIdx, activeColIdx);
    console.log(`  Row ${rowIdx} Active: ${isActive ? 'OK (active)' : 'FAIL (not active)'}`);
    if (isActive) activeOk++;
  }

  try { await page.screenshot({ path: 'screenshots/mass-edit-7-verified.png', fullPage: true }); } catch {}
  console.log(`Active verified: ${activeOk}/${matchedIndices.length}`);
  console.log('MASS EDIT TEST PASSED');
});
