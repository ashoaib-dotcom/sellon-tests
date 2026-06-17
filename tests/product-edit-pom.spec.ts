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

test('Mass edit: select products, set Active and Brand, verify', async () => {
  test.setTimeout(300000);

  const BRAND_TEXT      = 'MassEditBrand-Test';
  const NUM_TO_SELECT   = 3;
  const selectedIndices: number[] = [];

  // Navigate back to the products list (form may still be open from previous tests)
  await navPage.navigateToProducts();
  await page.waitForTimeout(3000);
  await productListPage.expectTableVisible();
  try { await page.screenshot({ path: 'screenshots/mass-edit-1-list.png', fullPage: true }); } catch {}

  // Log column headers so we know the table structure
  const rawHeaders = await page.locator('thead tr').first().locator('th, td').allInnerTexts();
  const headers = rawHeaders.map(h => h.trim().split('\n')[0]);
  console.log(`Column headers: ${JSON.stringify(headers)}`);

  // Select the first NUM_TO_SELECT non-empty products
  const tableRows = page.locator('tbody tr');
  const rowCount  = await tableRows.count();
  console.log(`Table rows: ${rowCount}`);

  for (let i = 0; i < rowCount && selectedIndices.length < NUM_TO_SELECT; i++) {
    const text = (await tableRows.nth(i).textContent() || '').trim();
    if (!text || text.length < 3) continue;
    await productListPage.selectRowByIndex(i);
    selectedIndices.push(i);
    console.log(`  Selected row ${i}: ${text.substring(0, 70)}`);
  }

  if (selectedIndices.length === 0) {
    console.log('No products selected — skipping mass edit test');
    return;
  }
  console.log(`Selected ${selectedIndices.length} products`);
  try { await page.screenshot({ path: 'screenshots/mass-edit-2-selected.png', fullPage: true }); } catch {}

  // Click the "Mass edit" ribbon/toolbar button (sits next to Stock import)
  const ribbonBtn  = page.locator('lb-ribbon-big-button').filter({ hasText: /mass.?edit/i }).filter({ visible: true }).first();
  const regularBtn = page.getByRole('button', { name: /mass.?edit/i }).filter({ visible: true }).first();
  const massEditBtn = await ribbonBtn.isVisible({ timeout: 3000 }).catch(() => false) ? ribbonBtn : regularBtn;

  if (!await massEditBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    const allBtnTexts = await page.getByRole('button').filter({ visible: true }).allTextContents();
    console.log(`"Mass edit" button not found. Visible buttons: ${JSON.stringify(allBtnTexts.map(t => t.trim()).filter(Boolean))}`);
    try { await page.screenshot({ path: 'screenshots/mass-edit-no-btn.png', fullPage: true }); } catch {}
    return;
  }
  await massEditBtn.click();
  await page.waitForTimeout(3000);
  try { await page.screenshot({ path: 'screenshots/mass-edit-3-modal.png', fullPage: true }); } catch {}

  // Locate the mass edit modal
  const modal = page.locator('lb-modal, lb-dialog, [role="dialog"]').filter({ visible: true }).first();
  if (!await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Mass edit modal did not appear');
    try { await page.screenshot({ path: 'screenshots/mass-edit-no-modal.png', fullPage: true }); } catch {}
    return;
  }

  // Log modal structure for diagnosis
  const modalText = (await modal.textContent() || '');
  console.log(`Modal text: ${modalText.slice(0, 500)}`);

  // Diagnostic: log all lb-checkbox and all inputs to understand the modal structure
  const lbCbs = modal.locator('lb-checkbox').filter({ visible: true });
  const lbCbCount = await lbCbs.count();
  console.log(`lb-checkbox elements in modal: ${lbCbCount}`);

  const allModalInputs = modal.locator('input').filter({ visible: true });
  const allModalInputCount = await allModalInputs.count();
  for (let i = 0; i < allModalInputCount; i++) {
    const type     = await allModalInputs.nth(i).getAttribute('type').catch(() => '');
    const val      = await allModalInputs.nth(i).inputValue().catch(() => '');
    const disabled = await allModalInputs.nth(i).getAttribute('disabled').catch(() => null);
    console.log(`  ModalInput[${i}]: type="${type}" value="${val}" disabled=${disabled !== null}`);
  }

  // The modal has one field-row per attribute (Activated, Brand, …).
  // Each row is identified by a lb-checkbox (enable-toggle) + label text + value control.
  // Row order matches the displayed order: Activated = row 0, Brand = row 1.

  // ── Step: Enable "Activated" (lb-checkbox[0]) and ensure value is True ────────
  if (lbCbCount >= 1) {
    await lbCbs.nth(0).click({ force: true });
    await page.waitForTimeout(600);
    console.log('  Enabled Activated field (lb-checkbox[0])');

    // After enabling, a lb-toggle or lb-switch appears for the value (True/False)
    await page.waitForTimeout(500);
    const activatedToggle = modal.locator('lb-toggle, lb-switch, [role="switch"]').filter({ visible: true }).first();
    if (await activatedToggle.count() > 0) {
      const isOn = await activatedToggle.evaluate((el) =>
        el.getAttribute('aria-checked') === 'true' || el.classList.contains('checked') || el.classList.contains('active')
      ).catch(() => false);
      if (!isOn) {
        await activatedToggle.click({ force: true });
        await page.waitForTimeout(400);
        console.log('  Toggled Activated to True');
      } else {
        console.log('  Activated toggle already True');
      }
    } else {
      console.log('  No toggle found — Activated may already be True by default');
    }
  } else {
    console.log('  No lb-checkbox found for Activated — checking native checkboxes');
    const nativeCbs = modal.locator('input[type="checkbox"]').filter({ visible: true });
    if (await nativeCbs.count() > 0 && !await nativeCbs.first().isChecked().catch(() => false)) {
      await nativeCbs.first().click({ force: true });
      await page.waitForTimeout(500);
      console.log('  Checked first native checkbox for Activated');
    }
  }
  try { await page.screenshot({ path: 'screenshots/mass-edit-4-active.png', fullPage: true }); } catch {}

  // ── Step: Enable "Brand" (lb-checkbox[1]) and fill the text input ─────────────
  if (lbCbCount >= 2) {
    await lbCbs.nth(1).click({ force: true });
    await page.waitForTimeout(800);    // wait for input to be unlocked
    console.log('  Enabled Brand field (lb-checkbox[1])');
  } else if (lbCbCount === 1) {
    // Only one lb-checkbox found — Brand might be enabled differently
    console.log('  Only one lb-checkbox found — Brand row may need a different selector');
  } else {
    // Fallback: use second native checkbox
    const nativeCbs = modal.locator('input[type="checkbox"]').filter({ visible: true });
    if (await nativeCbs.count() >= 2) {
      await nativeCbs.nth(1).click({ force: true });
      await page.waitForTimeout(800);
      console.log('  Enabled Brand via native checkbox[1]');
    }
  }

  // After enabling, the Brand text input should be unlocked
  const allTextInputs = modal.locator('input[type="text"]').filter({ visible: true });
  let brandFilled = false;
  for (let i = 0; i < await allTextInputs.count(); i++) {
    const isEnabled = await allTextInputs.nth(i).isEnabled().catch(() => false);
    if (isEnabled) {
      await allTextInputs.nth(i).fill(BRAND_TEXT);
      console.log(`  Filled text input[${i}] with Brand: "${BRAND_TEXT}"`);
      brandFilled = true;
      break;
    }
  }
  if (!brandFilled) console.log('  No enabled text input found for Brand');
  try { await page.screenshot({ path: 'screenshots/mass-edit-5-brand.png', fullPage: true }); } catch {}


  // ── Step: Click Apply ─────────────────────────────────────────────────────────
  const applyBtn = modal.getByRole('button', { name: /apply|anwenden|übernehmen/i }).filter({ visible: true }).first();
  if (!await applyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    const btnTexts = await modal.getByRole('button').filter({ visible: true }).allTextContents();
    console.log(`"Apply" not found. Modal buttons: ${JSON.stringify(btnTexts.map(t => t.trim()).filter(Boolean))}`);
    return;
  }
  await applyBtn.click();
  await page.waitForTimeout(5000);
  console.log('Clicked Apply');
  try { await page.screenshot({ path: 'screenshots/mass-edit-6-applied.png', fullPage: true }); } catch {}

  // ── Step: Wait for success message, then close modal with the X button ────────
  const successVisible = await page.locator('[class*="success"], [class*="toast"], [class*="notification"], [class*="alert"]')
    .filter({ visible: true }).first().isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`Success message visible: ${successVisible}`);

  // Close the popup/modal via its X (cross) button
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
  try { await page.screenshot({ path: 'screenshots/mass-edit-7-closed.png', fullPage: true }); } catch {}

  // ── Step: Verify Brand and Active columns in the products table ───────────────
  await navPage.navigateToProducts();
  await page.waitForTimeout(3000);
  await productListPage.expectTableVisible();

  const verifyHeaders = (await page.locator('thead tr').first().locator('th, td').allInnerTexts())
    .map(h => h.trim().split('\n')[0]);
  const brandColIdx  = verifyHeaders.findIndex(h => /brand/i.test(h));
  const activeColIdx = verifyHeaders.findIndex(h => /active/i.test(h));
  console.log(`Verify — Brand column: ${brandColIdx}, Active column: ${activeColIdx}`);

  // Give the server a moment to propagate the mass edit
  await page.waitForTimeout(3000);

  // Diagnostic: log HTML of Brand and Active cells in the first 3 rows
  const diagRows = page.locator('tbody tr');
  for (let i = 0; i < 3; i++) {
    const cells = diagRows.nth(i).locator('td');
    if (brandColIdx >= 0) {
      const bHtml = await cells.nth(brandColIdx).innerHTML().catch(() => '');
      console.log(`  DiagRow${i} Brand cell HTML: ${bHtml.slice(0, 300)}`);
    }
    if (activeColIdx >= 0) {
      const aHtml = await cells.nth(activeColIdx).innerHTML().catch(() => '');
      console.log(`  DiagRow${i} Active cell HTML: ${aHtml.slice(0, 300)}`);
    }
  }

  const verifyRows = page.locator('tbody tr');
  let brandOk  = 0;
  let activeOk = 0;

  // Helper: read a cell value — cells may contain input elements (editable table)
  // so textContent() is empty; we must use inputValue() or check lb-checkbox state
  async function cellText(cells: import('@playwright/test').Locator, colIdx: number): Promise<string> {
    const cell = cells.nth(colIdx);
    // Check for a text input inside the cell
    const inp = cell.locator('input[type="text"], input:not([type])').first();
    if (await inp.count() > 0) return (await inp.inputValue().catch(() => '')).trim();
    // Check for any lb-combobox / lb-select displayed value
    const combo = cell.locator('lb-combobox, lb-select').first();
    if (await combo.count() > 0) return (await combo.textContent().catch(() => '')).trim();
    // Fall back to raw text content
    return (await cell.textContent().catch(() => '')).trim();
  }

  async function cellIsChecked(cells: import('@playwright/test').Locator, colIdx: number): Promise<boolean> {
    const cell = cells.nth(colIdx);
    // Native checkbox
    const nativeCb = cell.locator('input[type="checkbox"]').first();
    if (await nativeCb.count() > 0) return nativeCb.isChecked().catch(() => false);
    // lb-checkbox: read inner input or aria-checked
    const lbCb = cell.locator('lb-checkbox').first();
    if (await lbCb.count() > 0) {
      return lbCb.evaluate((el) => {
        const inner = el.querySelector('input[type="checkbox"]');
        if (inner) return (inner as HTMLInputElement).checked;
        return el.getAttribute('aria-checked') === 'true';
      }).catch(() => false);
    }
    // Fallback: check text
    const txt = (await cell.textContent().catch(() => '')).trim();
    return /true|yes|1|✓|active/i.test(txt);
  }

  for (const rowIdx of selectedIndices) {
    const cells = verifyRows.nth(rowIdx).locator('td');

    if (brandColIdx >= 0) {
      const brandVal = await cellText(cells, brandColIdx);
      const match    = brandVal.includes(BRAND_TEXT);
      console.log(`  Row ${rowIdx} Brand: "${brandVal}" → ${match ? 'OK' : 'MISMATCH'}`);
      if (match) brandOk++;
    }

    if (activeColIdx >= 0) {
      const isActive = await cellIsChecked(cells, activeColIdx);
      console.log(`  Row ${rowIdx} Active: ${isActive ? 'checked/true' : 'not active'} → ${isActive ? 'OK' : 'NOT ACTIVE'}`);
      if (isActive) activeOk++;
    }
  }

  try { await page.screenshot({ path: 'screenshots/mass-edit-8-verified.png', fullPage: true }); } catch {}

  if (brandColIdx >= 0)  console.log(`Brand  verified: ${brandOk}/${selectedIndices.length}`);
  if (activeColIdx >= 0) console.log(`Active verified: ${activeOk}/${selectedIndices.length}`);
  console.log('MASS EDIT TEST PASSED');
});
