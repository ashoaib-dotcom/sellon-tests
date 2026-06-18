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
  await page.locator('.menu-icon').waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

async function navigateToProducts(page) {
  try {
    const modal = page.locator('lb-modal.blocking');
    if (await modal.isVisible()) { await page.keyboard.press('Escape'); await page.waitForTimeout(2000); }
  } catch {}
  await page.locator('.menu-icon').click();
  await page.waitForTimeout(2000);

  const productItems = page.locator('nav').getByText('Product', { exact: true });
  if (await productItems.count() < 2) {
    await productItems.first().scrollIntoViewIfNeeded();
    await productItems.first().click({ force: true });
    await page.waitForTimeout(2000);
  }
  await page.locator('nav').getByText('Product', { exact: true }).nth(1).dispatchEvent('click');
  await page.waitForTimeout(15000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  // Intercept API calls
  const apiResponses = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if ((url.includes('/api/') || url.includes('/product')) && resp.status() === 200) {
      try {
        const body = await resp.json();
        apiResponses.push({ url, body });
      } catch {}
    }
  });

  try {
    await login(page);
    await navigateToProducts(page);

    // Headers
    const rawHeaders = await page.locator('thead tr').first().locator('th, td').allInnerTexts();
    const headers = rawHeaders.map(h => h.trim().split('\n')[0]);
    console.log('Headers:', JSON.stringify(headers));
    console.log('');

    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();
    console.log(`Total rows: ${rowCount}\n`);

    for (let i = 0; i < rowCount; i++) {
      const cells = rows.nth(i).locator('td');
      const cellCount = await cells.count();
      const cellTexts = [];
      for (let j = 0; j < cellCount; j++) {
        const txt = (await cells.nth(j).innerText().catch(() => '')).trim();
        const hasCheck = await cells.nth(j).evaluate(el => !!el.querySelector('.fa-check, [class*="fa-check"]')).catch(() => false);
        const hasTimes = await cells.nth(j).evaluate(el => !!el.querySelector('.fa-times, [class*="fa-times"]')).catch(() => false);
        let display = txt || (hasCheck ? '✓' : '') || (hasTimes ? '✗' : '') || '-';
        cellTexts.push(display);
      }
      console.log(`Row ${i}: ${cellTexts.join(' | ')}`);
    }

    console.log('\n=== API Calls captured ===');
    if (apiResponses.length === 0) {
      console.log('(none captured — API might use different path)');
    }
    apiResponses.forEach(r => {
      const bodyStr = JSON.stringify(r.body).substring(0, 300);
      console.log(`URL: ${r.url.substring(0, 80)}`);
      console.log(`Body: ${bodyStr}`);
      console.log('');
    });

    // Now open the first product and look at the API call it triggers
    console.log('\n=== Opening first product ===');
    const firstRow = page.locator('tbody tr').first();
    const apiCallsBeforeOpen = apiResponses.length;
    await firstRow.dblclick();
    await page.waitForTimeout(8000);

    // Any new API calls?
    const newCalls = apiResponses.slice(apiCallsBeforeOpen);
    console.log(`New API calls after opening: ${newCalls.length}`);
    newCalls.forEach(r => {
      const bodyStr = JSON.stringify(r.body).substring(0, 500);
      console.log(`URL: ${r.url.substring(0, 120)}`);
      // Search for DgProductId-like fields
      const bodyFull = JSON.stringify(r.body);
      if (bodyFull.includes('dgProductId') || bodyFull.includes('DgProductId') || bodyFull.includes('buyerPid') ||
          bodyFull.includes('galaxusId') || bodyFull.includes('GalaxusId') || bodyFull.includes('articleId')) {
        console.log('*** Found DgProductId-like field ***');
        console.log('Full body:', bodyFull.substring(0, 1000));
      } else {
        console.log(`Body: ${bodyStr}`);
      }
      console.log('');
    });

    // Also dump all inputs in the opened form
    const saveVisible = await page.getByText('Save', { exact: true }).isVisible({ timeout: 5000 }).catch(() => false);
    if (saveVisible) {
      console.log('\n=== Form inputs ===');
      const inputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input')).map(el => ({
          formControlName: el.getAttribute('formcontrolname') || '',
          id: el.id || '',
          name: el.name || '',
          value: el.value || '',
          type: el.type,
        })).filter(e => e.value && e.type !== 'hidden' && e.type !== 'checkbox');
      });
      inputs.forEach(i => console.log(JSON.stringify(i)));

      // Also look for any element that might show a "Galaxus" or "DG" related ID
      const allText = await page.evaluate(() => document.body.innerText);
      const lines = allText.split('\n').filter(l =>
        l.includes('Galaxus') || l.includes('DG') || l.includes('Article') ||
        l.includes('Product ID') || l.includes('Buyer') || l.includes('GTIN')
      );
      console.log('\n=== Lines with Galaxus/DG/Article/GTIN ===');
      lines.forEach(l => console.log(' >', l.trim()));

      // Click "Supplementary data" tab if present
      const tabs = page.locator('[role="tab"]');
      const tabCount = await tabs.count();
      console.log(`\nTabs with [role=tab]: ${tabCount}`);

      // Try clicking tabs by text
      const tabTexts = ['Supplementary data', 'Supplementary', 'Additional', 'DG', 'Galaxus', 'Master data', 'Price & stock'];
      for (const tabText of tabTexts) {
        const tab = page.getByText(tabText, { exact: true }).filter({ visible: true });
        if (await tab.count() > 0) {
          await tab.first().click({ force: true });
          await page.waitForTimeout(2000);
          const body = await page.evaluate(() => document.body.innerText);
          const lines2 = body.split('\n').filter(l => l.trim());
          console.log(`\nTab "${tabText}" content (non-empty lines):`);
          lines2.slice(0, 30).forEach(l => console.log('  >', l.trim()));
          break;
        }
      }
    }

  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();
