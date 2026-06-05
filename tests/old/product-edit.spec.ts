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
  console.log('Step 1: Logging in...');
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
    console.log('Step 2: Session popup handled');
  } catch {
    console.log('Step 2: No session popup');
  }

  console.log('Step 3: Waiting for dashboard...');
  await page.waitForTimeout(60000);

  // Navigate to Product page
  console.log('Step 4: Navigating to Product page...');
  try {
    const modal = page.locator('lb-modal.blocking');
    const isVisible = await modal.isVisible();
    if (isVisible) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(2000);
    }
  } catch {
    // No modal
  }

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
// STEP 1: OPEN EDIT FORM
// ==========================================

test('Edit: should double-click a product to open edit form', async () => {
  test.setTimeout(120000);

  await expect(page.getByTitle('ID', { exact: true })).toBeVisible({ timeout: 30000 });

  // Double-click on the first Battery charger product
  const productRow = page.locator('tr').filter({ hasText: 'Battery char' }).first();
  await productRow.dblclick();
  await page.waitForTimeout(10000);

  // Verify edit form opened - should see "Product Details" and "Save" button
await expect(page.locator('lb-view-panel').getByText('Product Details')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Save', { exact: true })).toBeVisible();

  await page.screenshot({ path: 'screenshots/edit-form-opened.png', fullPage: true });

  console.log('EDIT FORM OPENED');
});

// ==========================================
// STEP 2: VERIFY MASTER DATA TAB
// ==========================================

test('Edit: should verify Master data tab fields', async () => {
  test.setTimeout(60000);

  // Verify Master data tab is active
  await expect(page.getByText('Master data', { exact: true })).toBeVisible();

  // Verify key fields are visible
  await expect(page.getByText('GTIN')).toBeVisible();
  await expect(page.getByText('Provider key')).toBeVisible();
  await expect(page.getByText('Brand')).toBeVisible();
  await expect(page.getByText('Category')).toBeVisible();
  await expect(page.getByText('Title')).toBeVisible();
  await expect(page.getByText('Description')).toBeVisible();
  await expect(page.getByText('Weight')).toBeVisible();

  // Verify toolbar buttons
  await expect(page.getByText('Save', { exact: true })).toBeVisible();
  await expect(page.getByText('Cancel', { exact: true })).toBeVisible();
  await expect(page.getByText('Delete', { exact: true })).toBeVisible();

  // Verify tabs exist
  await expect(page.getByText('Supplementary data', { exact: true })).toBeVisible();
  await expect(page.getByText('Price & stock', { exact: true })).toBeVisible();
  await expect(page.getByText('Media', { exact: true })).toBeVisible();

  console.log('MASTER DATA TAB VERIFIED');
});

// ==========================================
// STEP 3: EDIT BRAND FIELD
// ==========================================

test('Edit: should edit the Brand field', async () => {
  test.setTimeout(120000);

  // Find the Brand input field (it shows "PowerCell")
  const brandInput = page.locator('input').filter({ hasText: '' }).nth(0);

  // Use JavaScript to find the Brand input by looking near the "Brand" label
  const brandFieldEdited = await page.evaluate(() => {
    const labels = document.querySelectorAll('label, [class*="label"], span, div');
    for (const label of labels) {
      if (label.textContent?.trim() === 'Brand') {
        // Find the nearest input
        const parent = label.closest('.field, .form-group, [class*="field"]') || label.parentElement;
        if (parent) {
          const input = parent.querySelector('input');
          if (input) {
            input.focus();
            input.value = 'PowerCell Updated';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
      }
    }
    return false;
  });

  console.log('Brand field edited:', brandFieldEdited);

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/edit-brand-updated.png', fullPage: true });

  console.log('BRAND FIELD EDITED');
});

// ==========================================
// STEP 4: EDIT WEIGHT FIELD
// ==========================================

test('Edit: should edit the Weight field', async () => {
  test.setTimeout(120000);

  const weightEdited = await page.evaluate(() => {
    const labels = document.querySelectorAll('label, [class*="label"], span, div');
    for (const label of labels) {
      if (label.textContent?.trim() === 'Weight') {
        const parent = label.closest('.field, .form-group, [class*="field"]') || label.parentElement;
        if (parent) {
          const input = parent.querySelector('input');
          if (input) {
            input.focus();
            input.value = '95.0000';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
      }
    }
    return false;
  });

  console.log('Weight field edited:', weightEdited);

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/edit-weight-updated.png', fullPage: true });

  console.log('WEIGHT FIELD EDITED');
});

// ==========================================
// STEP 5: NAVIGATE TO PRICE & STOCK TAB
// ==========================================

test('Edit: should navigate to Price & stock tab', async () => {
  test.setTimeout(120000);

  // Click on "Price & stock" tab
  await page.getByText('Price & stock', { exact: true }).click();
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'screenshots/edit-price-stock-tab.png', fullPage: true });

  // Print all visible fields on this tab
  const labels = await page.evaluate(() => {
    const elements = document.querySelectorAll('label, [class*="label"]');
    return Array.from(elements)
      .map(el => el.textContent?.trim())
      .filter(text => text && text.length > 0 && text.length < 50);
  });
  console.log('PRICE & STOCK LABELS:', labels);

  console.log('PRICE & STOCK TAB OPENED');
});

// ==========================================
// STEP 6: GO BACK TO MASTER DATA AND SAVE
// ==========================================

test('Edit: should save the changes', async () => {
  test.setTimeout(120000);

  // Go back to Master data tab
  await page.getByText('Master data', { exact: true }).click();
  await page.waitForTimeout(3000);

  // Take screenshot before saving
  await page.screenshot({ path: 'screenshots/edit-before-save.png', fullPage: true });

  // Click Save button
  await page.getByText('Save', { exact: true }).click();
  await page.waitForTimeout(10000);

  await page.screenshot({ path: 'screenshots/edit-after-save.png', fullPage: true });

  // Check for any success/error message
  const bodyText = await page.locator('body').innerText();
  console.log('Contains "saved":', bodyText.toLowerCase().includes('saved'));
  console.log('Contains "success":', bodyText.toLowerCase().includes('success'));
  console.log('Contains "error":', bodyText.toLowerCase().includes('error'));

  console.log('SAVE COMPLETE');
});