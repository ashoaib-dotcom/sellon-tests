import { chromium } from '@playwright/test';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const BASE_URL      = process.env.BASE_URL;
const TEST_USERNAME = process.env.TEST_USERNAME;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

async function login(page) {
  await page.goto(BASE_URL, { timeout: 120000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input', { timeout: 90000 });
  await page.getByRole('textbox', { name: 'Username' }).fill(TEST_USERNAME);
  await page.getByRole('textbox', { name: 'Password' }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Login' }).first().click();
  await page.waitForTimeout(8000);
  try {
    const btn = page.getByRole('button', { name: /Yes|Continue/i }).first();
    if (await btn.isVisible({ timeout: 5000 })) { await btn.click(); await page.waitForTimeout(4000); }
  } catch {}
  // Wait for the hamburger menu icon to confirm we're logged in
  await page.locator('.menu-icon').waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log('Logged in, URL:', page.url());
}

async function navigateToProducts(page) {
  // Dismiss any blocking modal
  try {
    const modal = page.locator('lb-modal.blocking');
    if (await modal.isVisible()) { await page.keyboard.press('Escape'); await page.waitForTimeout(2000); }
  } catch {}

  // Open sidebar
  await page.locator('.menu-icon').click();
  await page.waitForTimeout(2000);

  // Check if Product submenu is already expanded
  const productItems = page.locator('nav').getByText('Product', { exact: true });
  const visibleCount = await productItems.count();
  console.log('Product nav items:', visibleCount);

  if (visibleCount < 2) {
    const parentItem = productItems.first();
    await parentItem.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await parentItem.click({ force: true });
    await page.waitForTimeout(2000);
  }

  // Click the Product sub-item (nth(1))
  const subItem = page.locator('nav').getByText('Product', { exact: true }).nth(1);
  await subItem.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await subItem.dispatchEvent('click');
  await page.waitForTimeout(15000);

  // Close sidebar
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);
  console.log('Products page, URL:', page.url());
}

async function dumpAllFields(page, targetValue) {
  console.log('\n=== BODY TEXT ===');
  const bodyText = await page.evaluate(() => document.body.innerText);
  if (targetValue) console.log(`Body contains "${targetValue}":`, bodyText.includes(targetValue));

  console.log('\n=== INPUT VALUES ===');
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, textarea, select')).map(el => {
      const val = el.tagName === 'SELECT'
        ? Array.from(el.selectedOptions).map(o => o.text).join(', ')
        : el.value || '';
      const name = el.name || el.id || el.getAttribute('formcontrolname') ||
                   el.getAttribute('aria-label') || el.placeholder || '';
      const type = el.tagName === 'SELECT' ? 'select' : el.type;
      return { name, value: val.trim(), type };
    }).filter(e => e.value && e.type !== 'hidden' && e.type !== 'checkbox');
  });
  inputs.forEach(i => console.log(`  [${i.type}] ${i.name}: ${i.value}`));

  if (targetValue) {
    console.log(`\n=== ELEMENTS WITH "${targetValue}" ===`);
    const elements = await page.evaluate((val) => {
      const results = [];
      document.querySelectorAll('*').forEach(el => {
        const isLeaf = el.children.length === 0;
        const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
        if (isLeaf || isInput) {
          const text = isInput ? el.value : el.textContent;
          if (text && (text.trim() === val || text.includes(val))) {
            let parent = el.parentElement;
            let context = '';
            for (let i = 0; i < 4 && parent; i++) {
              context = parent.className || parent.tagName;
              if (context) break;
              parent = parent.parentElement;
            }
            results.push({
              tag: el.tagName,
              text: text.trim().substring(0, 80),
              class: el.className ? el.className.substring(0, 50) : '',
              id: el.id || '',
              formControlName: el.getAttribute('formcontrolname') || '',
              parentContext: context.substring(0, 60),
            });
          }
        }
      });
      return results.slice(0, 30);
    }, targetValue);
    elements.forEach(e => console.log(JSON.stringify(e)));
    if (elements.length === 0) console.log('  (none found)');
  }
}

async function clickAllTabs(page, targetValue) {
  // First dump the current (default) tab
  console.log('\n--- Default tab (no click) ---');
  await dumpAllFields(page, targetValue);

  const tabs = page.locator('[role="tab"]');
  const tabCount = await tabs.count();
  console.log(`\nFound ${tabCount} tabs`);

  for (let i = 0; i < tabCount; i++) {
    const txt = (await tabs.nth(i).innerText().catch(() => '')).trim();
    await tabs.nth(i).click({ force: true }).catch(() => {});
    await page.waitForTimeout(3000);
    const body = await page.evaluate(() => document.body.innerText);
    const found = targetValue ? body.includes(targetValue) : false;
    console.log(`\n--- Tab ${i}: "${txt}" | contains "${targetValue}": ${found} ---`);
    await dumpAllFields(page, targetValue);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  try {
    await login(page);
    await navigateToProducts(page);

    // Wait for table to load
    await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 30000 });
    const rowCount = await page.locator('tbody tr').count();
    console.log(`Table has ${rowCount} rows`);

    // Log first few rows to verify DEMO-100 is there
    for (let i = 0; i < Math.min(5, rowCount); i++) {
      const txt = (await page.locator('tbody tr').nth(i).innerText()).trim().substring(0, 80);
      console.log(`  Row ${i}: ${txt}`);
    }

    // Open DEMO-100
    const row = page.locator('tbody tr').filter({ hasText: 'DEMO-100' }).first();
    const cnt = await row.count();
    console.log(`\nDEMO-100 row count: ${cnt}`);
    if (cnt === 0) {
      // Try first row
      console.log('DEMO-100 not found, trying first row...');
      await page.locator('tbody tr').first().dblclick();
    } else {
      await row.dblclick();
    }
    await page.waitForTimeout(10000);
    console.log('After dblclick, URL:', page.url());

    // Check if form opened (Save button visible)
    const saveVisible = await page.getByText('Save', { exact: true }).isVisible({ timeout: 5000 }).catch(() => false);
    console.log('Save button visible:', saveVisible);
    if (!saveVisible) {
      console.log('Form did not open. Body snippet:');
      const b = await page.evaluate(() => document.body.innerText);
      console.log(b.substring(0, 500));
    } else {
      // Look for DgProductId=38083 and DG GTIN=7608998001002
      await clickAllTabs(page, '38083');
    }
  } catch (e) {
    console.error('ERROR:', e.message, e.stack);
  } finally {
    await browser.close();
  }
})();
