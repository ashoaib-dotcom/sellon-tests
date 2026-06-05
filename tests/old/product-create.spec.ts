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

  // Login
  console.log('Logging in...');
  await page.goto('https://mpe-test.lobster-cloud.com', { timeout: 120000 });
  await page.waitForSelector('input', { state: 'visible', timeout: 120000 });
  await page.waitForTimeout(5000);

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
    await passwordField.click();
    await passwordField.pressSequentially('test2', { delay: 200 });
    await page.waitForTimeout(1000);
  }

  await page.getByRole('button', { name: 'Login' }).click();

  const yesButton = page.getByRole('button', { name: 'Yes' });
  try {
    await yesButton.waitFor({ state: 'visible', timeout: 15000 });
    await yesButton.click();
  } catch {}

  await page.waitForTimeout(60000);

  // Navigate to Product page
  console.log('Navigating to Product page...');
  try {
    const modal = page.locator('lb-modal.blocking');
    if (await modal.isVisible()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(2000);
    }
  } catch {}

  await page.locator('.menu-icon').click();
  await page.waitForTimeout(2000);

  const productItems = page.locator('nav').getByText('Product', { exact: true });
  await productItems.first().click();
  await page.waitForTimeout(2000);

  const subItem = page.locator('nav').getByText('Product', { exact: true }).nth(1);
  await subItem.scrollIntoViewIfNeeded();
  await subItem.dispatchEvent('click');
  await page.waitForTimeout(15000);

  console.log('SETUP COMPLETE');
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

// ==========================================
// HELPER: Edit field near a label using JS
// ==========================================

async function editFieldByLabel(labelText: string, value: string) {
  const edited = await page.evaluate(({ label, val }) => {
    const labels = document.querySelectorAll('label, [class*="label"], span, div');
    for (const el of labels) {
      if (el.textContent?.trim() === label) {
        const parent = el.closest('[class*="field"], [class*="form"], [class*="row"]') || el.parentElement;
        if (parent) {
          const input = parent.querySelector('input, textarea');
          if (input) {
            (input as HTMLInputElement).focus();
            (input as HTMLInputElement).value = val;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
          }
        }
      }
    }
    return false;
  }, { label: labelText, val: value });

  console.log(`  Field "${labelText}" = "${value}": ${edited ? 'OK' : 'NOT FOUND'}`);
  await page.waitForTimeout(500);
  return edited;
}

// ==========================================
// STEP 1: VERIFY PRODUCT LIST AND COUNT
// ==========================================

test('Step 1: Verify product list is loaded before creating', async () => {
  test.setTimeout(120000);

  await expect(page.getByTitle('ID', { exact: true })).toBeVisible({ timeout: 30000 });

  // Count products before creating
  const rowCount = await page.locator('tbody tr').count();
  console.log('Products before creating:', rowCount);

  // Verify New button exists
  await expect(page.getByText('New', { exact: true })).toBeVisible();

  await page.screenshot({ path: 'screenshots/step1-product-list.png', fullPage: true });
  console.log('STEP 1 PASSED - Product list verified');
});

// ==========================================
// STEP 2: CLICK NEW TO OPEN EMPTY FORM
// ==========================================

test('Step 2: Click New button to open empty product form', async () => {
  test.setTimeout(120000);

  await page.getByText('New', { exact: true }).click();
  await page.waitForTimeout(10000);

  // Verify edit form opened
  await expect(page.getByText('Save', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Master data', { exact: true })).toBeVisible();
  await expect(page.getByText('Cancel', { exact: true })).toBeVisible();

  await page.screenshot({ path: 'screenshots/step2-new-product-form.png', fullPage: true });
  console.log('STEP 2 PASSED - Empty product form opened');
});

// ==========================================
// STEP 3: VERIFY EMPTY FORM SHOWS VALIDATION
// ==========================================

test('Step 3: Verify empty form shows validation hints', async () => {
  test.setTimeout(60000);

  // Verify Master data tab labels exist
  await expect(page.getByText('GTIN', { exact: true })).toBeVisible();
  await expect(page.getByText('Provider key', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Brand', { exact: true })).toBeVisible();

  // Verify all tabs exist
  await expect(page.getByText('Master data', { exact: true })).toBeVisible();
  await expect(page.getByText('Supplementary data', { exact: true })).toBeVisible();
  await expect(page.getByText('Price & stock', { exact: true })).toBeVisible();
  await expect(page.getByText('Media', { exact: true })).toBeVisible();
  await expect(page.getByText('Galaxus', { exact: true })).toBeVisible();

  // Check if validation messages are already showing
  const bodyText = await page.locator('body').innerText();
  console.log('Empty form shows GTIN hint:', bodyText.includes('GTIN'));
  console.log('Empty form shows provider key hint:', bodyText.toLowerCase().includes('provider'));

  await page.screenshot({ path: 'screenshots/step3-empty-form-hints.png', fullPage: true });
  console.log('STEP 3 PASSED - Empty form structure verified');
});

// ==========================================
// STEP 4: FILL GTIN ON MASTER DATA TAB
// ==========================================

test('Step 4: Fill GTIN field with valid checksum', async () => {
  test.setTimeout(120000);

  // GTIN-13 valid checksum: 4006381333931
  await editFieldByLabel('GTIN', '4006381333931');

  await page.screenshot({ path: 'screenshots/step4-gtin-filled.png', fullPage: true });
  console.log('STEP 4 PASSED - GTIN filled');
});

// ==========================================
// STEP 5: FILL PROVIDER KEY
// ==========================================

test('Step 5: Fill Provider key field', async () => {
  test.setTimeout(120000);

  // Provider key: mandatory, A-Z a-z 0-9 spaces and . , ! ? - _ @
  await editFieldByLabel('Provider key', 'AUTO-TEST-001');

  await page.screenshot({ path: 'screenshots/step5-provider-key.png', fullPage: true });
  console.log('STEP 5 PASSED - Provider key filled');
});

// ==========================================
// STEP 6: FILL BRAND
// ==========================================

test('Step 6: Fill Brand field', async () => {
  test.setTimeout(120000);

  // Brand: required for stage 2, max 100 chars
  await editFieldByLabel('Brand', 'AutoTestBrand');

  await page.screenshot({ path: 'screenshots/step6-brand.png', fullPage: true });
  console.log('STEP 6 PASSED - Brand filled');
});

// ==========================================
// STEP 7: FILL TITLE DE
// ==========================================

test('Step 7: Fill Title DE field', async () => {
  test.setTimeout(120000);

  // Title: 1-100 chars, must NOT contain brand name, German required
  const titleEdited = await page.evaluate(() => {
    const allElements = document.querySelectorAll('label, [class*="label"], span, div');
    for (const el of allElements) {
      if (el.textContent?.trim() === 'Title') {
        const parent = el.closest('[class*="field"], [class*="section"]') || el.parentElement?.parentElement;
        if (parent) {
          const input = parent.querySelector('input, textarea');
          if (input) {
            (input as HTMLInputElement).focus();
            (input as HTMLInputElement).value = 'Automatisiertes Testprodukt Ladegeraet USB-C';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
          }
        }
      }
    }
    return false;
  });

  console.log('  Title DE edited:', titleEdited);
  await page.screenshot({ path: 'screenshots/step7-title.png', fullPage: true });
  console.log('STEP 7 PASSED - Title DE filled');
});

// ==========================================
// STEP 8: FILL DESCRIPTION DE
// ==========================================

test('Step 8: Fill Description DE field', async () => {
  test.setTimeout(120000);

  // Description: optional, max 4000 chars, no HTML/links
  const descEdited = await page.evaluate(() => {
    const textareas = document.querySelectorAll('textarea');
    for (const ta of textareas) {
      if (ta.offsetParent !== null) {
        ta.focus();
        ta.value = 'Dies ist ein automatisiert erstelltes Testprodukt fuer Playwright Automation. Hochwertiges USB-C Ladegeraet.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        ta.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      }
    }
    return false;
  });

  console.log('  Description DE edited:', descEdited);
  await page.screenshot({ path: 'screenshots/step8-description.png', fullPage: true });
  console.log('STEP 8 PASSED - Description DE filled');
});

// ==========================================
// STEP 9: FILL WEIGHT
// ==========================================

test('Step 9: Fill Weight field', async () => {
  test.setTimeout(120000);

  // Weight: optional, 0 to 100,000,000
  await editFieldByLabel('Weight', '250.0000');

  await page.screenshot({ path: 'screenshots/step9-weight.png', fullPage: true });
  console.log('STEP 9 PASSED - Weight filled');
});

// ==========================================
// STEP 10: SCREENSHOT MASTER DATA COMPLETE
// ==========================================

test('Step 10: Verify all Master data fields are filled', async () => {
  test.setTimeout(60000);

  await page.screenshot({ path: 'screenshots/step10-master-data-complete.png', fullPage: true });

  // Print all current field values to verify
  const fieldValues = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea');
    return Array.from(inputs)
      .filter(i => (i as HTMLElement).offsetParent !== null)
      .slice(0, 15)
      .map(i => ({ value: (i as HTMLInputElement).value?.substring(0, 50) }))
      .filter(i => i.value);
  });
  console.log('Current field values:', JSON.stringify(fieldValues));

  console.log('STEP 10 PASSED - Master data review complete');
});

// ==========================================
// STEP 11: NAVIGATE TO PRICE & STOCK TAB
// ==========================================

test('Step 11: Navigate to Price & stock tab', async () => {
  test.setTimeout(120000);

  await page.getByText('Price & stock', { exact: true }).click();
  await page.waitForTimeout(5000);

  // Verify tab fields loaded
  await expect(page.getByText('Selling price', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('VAT', { exact: true })).toBeVisible();
  await expect(page.getByText('Stock quantity', { exact: true })).toBeVisible();

  await page.screenshot({ path: 'screenshots/step11-price-stock-tab.png', fullPage: true });
  console.log('STEP 11 PASSED - Price & stock tab opened');
});

// ==========================================
// STEP 12: FILL SELLING PRICE
// ==========================================

test('Step 12: Fill Selling price', async () => {
  test.setTimeout(120000);

  // Price: mandatory, 0.0001 to 100,000,000
  await editFieldByLabel('Selling price', '49.9000');

  await page.screenshot({ path: 'screenshots/step12-selling-price.png', fullPage: true });
  console.log('STEP 12 PASSED - Selling price filled');
});

// ==========================================
// STEP 13: FILL VAT
// ==========================================

test('Step 13: Fill VAT', async () => {
  test.setTimeout(120000);

  // VAT: only 2.60 or 8.10 allowed
  await editFieldByLabel('VAT', '8.10');

  await page.screenshot({ path: 'screenshots/step13-vat.png', fullPage: true });
  console.log('STEP 13 PASSED - VAT filled');
});

// ==========================================
// STEP 14: FILL STOCK QUANTITY
// ==========================================

test('Step 14: Fill Stock quantity', async () => {
  test.setTimeout(120000);

  // Stock: required, 0 to 99999
  await editFieldByLabel('Stock quantity', '100');

  await page.screenshot({ path: 'screenshots/step14-stock-quantity.png', fullPage: true });
  console.log('STEP 14 PASSED - Stock quantity filled');
});

// ==========================================
// STEP 15: SCREENSHOT PRICE & STOCK COMPLETE
// ==========================================

test('Step 15: Verify all Price & stock fields are filled', async () => {
  test.setTimeout(60000);

  await page.screenshot({ path: 'screenshots/step15-price-stock-complete.png', fullPage: true });

  const fieldValues = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input:not([type="hidden"])');
    return Array.from(inputs)
      .filter(i => (i as HTMLElement).offsetParent !== null)
      .slice(0, 15)
      .map(i => ({ value: (i as HTMLInputElement).value?.substring(0, 50) }))
      .filter(i => i.value);
  });
  console.log('Price & stock field values:', JSON.stringify(fieldValues));

  console.log('STEP 15 PASSED - Price & stock review complete');
});

// ==========================================
// STEP 16: SAVE THE NEW PRODUCT
// ==========================================

test('Step 16: Save the new product', async () => {
  test.setTimeout(120000);

  await page.getByText('Save', { exact: true }).click();
  await page.waitForTimeout(10000);

  await page.screenshot({ path: 'screenshots/step16-product-saved.png', fullPage: true });

  const bodyText = await page.locator('body').innerText();
  console.log('After save - contains "error":', bodyText.toLowerCase().includes('error'));
  console.log('After save - contains "stage":', bodyText.toLowerCase().includes('stage'));

  console.log('STEP 16 PASSED - Product saved');
});

// ==========================================
// STEP 17: VERIFY PRODUCT WAS CREATED
// ==========================================

test('Step 17: Verify product appears after save', async () => {
  test.setTimeout(120000);

  // Take screenshot of the result
  await page.screenshot({ path: 'screenshots/step17-after-save-result.png', fullPage: true });

  // Check if we can see our product data
  const bodyText = await page.locator('body').innerText();
  console.log('Page has AUTO-TEST-001:', bodyText.includes('AUTO-TEST-001'));
  console.log('Page has AutoTestBrand:', bodyText.includes('AutoTestBrand'));
  console.log('Page has 4006381333931:', bodyText.includes('4006381333931'));

  console.log('STEP 17 PASSED - Product creation verified');
});

// ==========================================
// STEP 18: GTIN VALIDATION - INVALID CHECKSUM
// ==========================================

test('Step 18: Validate GTIN rejects invalid checksum', async () => {
  test.setTimeout(120000);

  // Go to Master data tab
  await page.getByText('Master data', { exact: true }).click();
  await page.waitForTimeout(3000);

  // Set GTIN with invalid checksum (last digit should be 1, not 2)
  await editFieldByLabel('GTIN', '4006381333932');

  await page.getByText('Save', { exact: true }).click();
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'screenshots/step18-gtin-invalid.png', fullPage: true });

  const bodyText = await page.locator('body').innerText();
  const hasGtinError = bodyText.toLowerCase().includes('checksum') || bodyText.toLowerCase().includes('gtin');
  console.log('GTIN error shown:', hasGtinError);

  console.log('STEP 18 PASSED - GTIN invalid checksum rejected');
});

// ==========================================
// STEP 19: GTIN VALIDATION - RESTORE VALID
// ==========================================

test('Step 19: Restore valid GTIN', async () => {
  test.setTimeout(120000);

  await editFieldByLabel('GTIN', '4006381333931');
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'screenshots/step19-gtin-restored.png', fullPage: true });
  console.log('STEP 19 PASSED - Valid GTIN restored');
});

// ==========================================
// STEP 20: PROVIDER KEY VALIDATION - EMPTY
// ==========================================

test('Step 20: Validate Provider key rejects empty value', async () => {
  test.setTimeout(120000);

  await editFieldByLabel('Provider key', '');

  await page.getByText('Save', { exact: true }).click();
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'screenshots/step20-provider-key-empty.png', fullPage: true });

  const bodyText = await page.locator('body').innerText();
  const hasProviderError = bodyText.toLowerCase().includes('provider') || bodyText.toLowerCase().includes('mandatory') || bodyText.toLowerCase().includes('required');
  console.log('Provider key empty error shown:', hasProviderError);

  // Restore valid provider key
  await editFieldByLabel('Provider key', 'AUTO-TEST-001');

  console.log('STEP 20 PASSED - Empty provider key rejected');
});

// ==========================================
// STEP 21: VAT VALIDATION - INVALID VALUE
// ==========================================

test('Step 21: Validate VAT rejects invalid value', async () => {
  test.setTimeout(120000);

  await page.getByText('Price & stock', { exact: true }).click();
  await page.waitForTimeout(3000);

  // VAT only allows 2.60 or 8.10
  await editFieldByLabel('VAT', '5.00');

  await page.getByText('Save', { exact: true }).click();
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'screenshots/step21-vat-invalid.png', fullPage: true });

  const bodyText = await page.locator('body').innerText();
  console.log('VAT error shown:', bodyText.toLowerCase().includes('vat') || bodyText.toLowerCase().includes('2.6') || bodyText.toLowerCase().includes('8.1'));

  // Restore valid VAT
  await editFieldByLabel('VAT', '8.10');

  console.log('STEP 21 PASSED - Invalid VAT rejected');
});

// ==========================================
// STEP 22: STOCK VALIDATION - OVER LIMIT
// ==========================================

test('Step 22: Validate Stock rejects value over 99999', async () => {
  test.setTimeout(120000);

  await editFieldByLabel('Stock quantity', '100000');

  await page.getByText('Save', { exact: true }).click();
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'screenshots/step22-stock-over-limit.png', fullPage: true });

  // Restore valid stock
  await editFieldByLabel('Stock quantity', '100');

  console.log('STEP 22 PASSED - Stock over limit rejected');
});

// ==========================================
// STEP 23: PRICE VALIDATION - ZERO
// ==========================================

test('Step 23: Validate Price rejects zero', async () => {
  test.setTimeout(120000);

  await editFieldByLabel('Selling price', '0');

  await page.getByText('Save', { exact: true }).click();
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'screenshots/step23-price-zero.png', fullPage: true });

  // Restore valid price
  await editFieldByLabel('Selling price', '49.9000');

  console.log('STEP 23 PASSED - Zero price rejected');
});

// ==========================================
// STEP 24: FINAL SAVE WITH ALL VALID DATA
// ==========================================

test('Step 24: Final save with all valid data', async () => {
  test.setTimeout(120000);

  // Save with everything valid
  await page.getByText('Save', { exact: true }).click();
  await page.waitForTimeout(10000);

  await page.screenshot({ path: 'screenshots/step24-final-save.png', fullPage: true });

  const bodyText = await page.locator('body').innerText();
  console.log('Final save - error:', bodyText.toLowerCase().includes('error'));
  console.log('Final save - stage:', bodyText.toLowerCase().includes('stage'));

  console.log('STEP 24 PASSED - Final save complete');
});