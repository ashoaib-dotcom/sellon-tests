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

  try {
    await login(page);
    await navigateToProducts(page);

    // Open first product
    await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('tbody tr').first().dblclick();
    await page.waitForTimeout(10000);
    console.log('Form opened, URL:', page.url());

    // Find all clickable tab-like elements in the form area
    const allClickableTexts = await page.evaluate(() => {
      const results = [];
      // Look for tab-like elements - text nodes inside typical tab containers
      const selectors = [
        'lb-tab', '[role="tab"]', '.tab-header', '.nav-tabs li', '.tab-item',
        '[class*="tab"]', 'ul.tabs li', 'div.tabs div'
      ];
      for (const sel of selectors) {
        const els = Array.from(document.querySelectorAll(sel));
        els.forEach(el => {
          const txt = el.textContent.trim();
          if (txt && txt.length < 50) results.push({ selector: sel, text: txt });
        });
      }
      return results.filter((r, i, a) => a.findIndex(x => x.text === r.text) === i);
    });
    console.log('\nClickable tab-like elements:');
    allClickableTexts.forEach(t => console.log(`  [${t.selector}] "${t.text}"`));

    // Try clicking "Supplementary data" by any means
    const suppData = page.getByText('Supplementary data', { exact: true }).filter({ visible: true });
    const suppCount = await suppData.count();
    console.log(`\n"Supplementary data" visible elements: ${suppCount}`);
    if (suppCount > 0) {
      await suppData.first().click({ force: true });
      await page.waitForTimeout(3000);

      // Now look for the Galaxus subsection
      const galaxusEl = page.getByText('Galaxus', { exact: true }).filter({ visible: true });
      console.log('"Galaxus" visible: ', await galaxusEl.count());

      // Dump ALL inputs in this tab
      const inputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input, textarea')).map(el => ({
          id: el.id || '',
          name: el.name || '',
          placeholder: el.placeholder || '',
          formControlName: el.getAttribute('formcontrolname') || '',
          value: el.value || '',
          type: el.type,
          isVisible: (el).offsetParent !== null,
        })).filter(e => e.type !== 'hidden' && e.type !== 'checkbox');
      });
      console.log('\nAll form inputs (including empty):');
      inputs.filter(i => i.isVisible).forEach(i => console.log(JSON.stringify(i)));

      // Take screenshot to understand the UI
      await page.screenshot({ path: 'scripts/supplementary-tab.png', fullPage: false });
      console.log('\nScreenshot saved to scripts/supplementary-tab.png');

      // Dump the body text of the whole form
      const bodyText = await page.evaluate(() => document.body.innerText);
      const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
      console.log('\nAll non-empty text lines in Supplementary data tab:');
      lines.forEach(l => console.log(' >', l));
    }

    // Also try the "Galaxus" tab directly
    await page.getByText('Master data', { exact: true }).filter({ visible: true }).first().click({ force: true });
    await page.waitForTimeout(2000);

    // Check URL changes per tab click
    console.log('\n=== Checking network requests for product details ===');
    const responses = [];
    page.on('response', async r => {
      try {
        if (r.status() === 200) {
          const ct = r.headers()['content-type'] || '';
          if (ct.includes('json')) {
            const body = await r.json();
            const str = JSON.stringify(body);
            if (str.includes('DgProductId') || str.includes('dgProductId') || str.includes('galaxusId') ||
                str.includes('38083') || str.includes('30909') || str.includes('buyerPid')) {
              responses.push({ url: r.url(), body: str.substring(0, 500) });
            }
          }
        }
      } catch {}
    });

    // Reload product form
    await page.locator('.menu-icon').click().catch(() => {});
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.locator('tbody tr').first().dblclick().catch(() => {});
    await page.waitForTimeout(5000);

    console.log('\nAPI responses with DG IDs:', responses.length);
    responses.forEach(r => console.log(r.url, '\n', r.body));

  } catch (e) {
    console.error('ERROR:', e.message, '\n', e.stack);
  } finally {
    await browser.close();
  }
})();
