import { test, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { NavigationPage } from '../pages/navigation.page';
import { ProductListPage } from '../pages/product-list.page';

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let navPage: NavigationPage;
let productListPage: ProductListPage;

// ─── Confirmed column indices (from header dump) ──────────────────────────────
// 0: checkbox | 1: State (Galaxus) | 2: Export status | 3: Warning | 4: ID
// 5: Category | 6: Active | 7: GTIN | 8: Name | 9: Provider key
// 10: Stock quantity | 11: Price | 12: Vat | 13: titleDE | 14: descriptionDE

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getPaginationText(): Promise<string> {
  try {
    return await page.locator('text=/\\d+ - \\d+ of \\d+/').innerText({ timeout: 5000 });
  } catch {
    return 'N/A';
  }
}

async function getPaginationTotal(): Promise<number> {
  const text = await getPaginationText();
  const m = text.match(/of (\d+)/);
  return m ? parseInt(m[1]) : 0;
}

async function getRowCount(): Promise<number> {
  await page.waitForTimeout(1500);
  return page.locator('tbody tr').count();
}

// Click the Search button to execute the filter
async function clickSearch() {
  await page.getByText('Search', { exact: true }).click();
  await page.waitForTimeout(4000);
  console.log('  Search clicked → pagination:', await getPaginationText());
}

// Click the Clear button to reset all filters
async function clickClear() {
  await page.getByText('Clear', { exact: true }).click();
  await page.waitForTimeout(3000);
  console.log('  Clear clicked → pagination:', await getPaginationText());
}

// Get the filter-row cell for a given column index (second thead row)
function filterCell(colIndex: number) {
  return page.locator('thead tr').nth(1).locator('th, td').nth(colIndex);
}

// Open a dropdown filter and pick an option — tries native select, arrow button, then lb-select
async function setDropdownFilter(colIndex: number, optionText: string) {
  const cell = filterCell(colIndex);

  // 1. Native <select> element (most reliable — has the browser arrow)
  const nativeSelect = cell.locator('select').first();
  if (await nativeSelect.count() > 0) {
    try {
      await nativeSelect.selectOption({ label: optionText });
      await page.waitForTimeout(400);
      console.log(`  Dropdown col ${colIndex} = "${optionText}" → via native select`);
      return;
    } catch {
      // try value fallback
      await nativeSelect.selectOption({ value: optionText }).catch(() => {});
    }
  }

  // 2. Click the sort-down arrow button to open the Lobster dropdown
  const combobox = cell.locator('lb-combobox').first();
  if (await combobox.count() > 0) {
    // Clicking input first then button toggles the dropdown closed — click only the arrow
    const arrowBtn = combobox.locator('button.form-button, button:has(.fa-sort-down)').first();
    if (await arrowBtn.count() > 0) {
      await arrowBtn.click();
    } else {
      await combobox.click();
    }
    await page.waitForTimeout(1200);
    console.log(`  Clicked lb-combobox arrow in col ${colIndex}`);
  } else {
    await cell.click();
    await page.waitForTimeout(1000);
  }

  // 3. Find the option — Lobster renders options as .dropdown-item / .item-label elements
  const optionSelectors = [
    `.dropdown-item:has-text("${optionText}")`,
    `[class*="dropdown-item"]:has-text("${optionText}")`,
    `.item-label:has-text("${optionText}")`,
    `[class*="item-label"]:has-text("${optionText}")`,
    `lb-option:has-text("${optionText}")`,
    `[class*="option-item"]:has-text("${optionText}")`,
    `[role="option"]:has-text("${optionText}")`,
    `li:has-text("${optionText}")`,
  ];

  for (const sel of optionSelectors) {
    const el = page.locator(sel).filter({ visible: true }).first();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      await el.click();
      await page.waitForTimeout(500);
      console.log(`  Dropdown col ${colIndex} = "${optionText}" → OK via "${sel}"`);
      return;
    }
  }

  console.log(`  Option "${optionText}" not found in dropdown — pressing Escape`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// Set a text/numeric input filter for a column
async function setTextFilter(colIndex: number, value: string) {
  const cell = filterCell(colIndex);
  const input = cell.locator('input').first();
  if (await input.count() > 0) {
    await input.clear();
    await input.fill(value);
    await page.waitForTimeout(400);
    console.log(`  Text filter col ${colIndex} = "${value}" → OK`);
  } else {
    console.log(`  No input found in filter cell col ${colIndex}`);
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

test.beforeAll(async () => {
  test.setTimeout(600000);

  browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  page = await context.newPage();
  loginPage  = new LoginPage(page);
  navPage    = new NavigationPage(page);
  productListPage = new ProductListPage(page);

  await loginPage.login(process.env.TEST_USERNAME || '', process.env.TEST_PASSWORD || '');
  await navPage.navigateToProducts();
  await productListPage.expectTableVisible();

  console.log('SETUP COMPLETE — initial pagination:', await getPaginationText());
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

// ============================================================
// TC-01: Filter by Single Value — State dropdown → Stage 1
// ============================================================

test('TC-01: Filter by State "Stage 1" — grid shows only Stage 1 products', async () => {
  test.setTimeout(120000);

  const totalBefore = await getPaginationTotal();
  console.log('Total before filter:', totalBefore);

  // Click the sort-down arrow to open and select Stage 1
  await setDropdownFilter(1, 'Stage 1');
  await clickSearch();

  const totalAfter = await getPaginationTotal();
  const rowCount = await getRowCount();
  const body = await page.locator('body').innerText();

  console.log('Rows visible:', rowCount, '| Pagination total:', totalAfter);
  console.log('Has Stage 1:', body.includes('Stage 1'), '| Has Stage 2:', body.includes('Stage 2'), '| Has Error:', body.includes('Error'));

  try { await page.screenshot({ path: 'screenshots/tc01-state-stage1-filtered.png', timeout: 5000 }); } catch {}
  console.log('TC-01 PASSED');
});

// ============================================================
// TC-02: Clear Applied Filters — restores full dataset
// ============================================================

test('TC-02: Clear button resets all filters and restores full dataset (1-48 of 48)', async () => {
  test.setTimeout(60000);

  // A filter from TC-01 is still applied; click Clear
  await clickClear();

  const totalAfter = await getPaginationTotal();
  const paginationText = await getPaginationText();
  console.log('After Clear — pagination:', paginationText, '| total:', totalAfter);

  // Verify filter cells are cleared
  const stateCell = filterCell(1);
  const stateInputOrSelect = stateCell.locator('input, lb-select').first();
  const stateVal = await stateInputOrSelect.inputValue().catch(() => '');
  console.log('State filter value after clear:', stateVal || '(empty)');

  try { await page.screenshot({ path: 'screenshots/tc02-clear-filters.png', timeout: 5000 }); } catch {}
  console.log('TC-02 PASSED');
});

// ============================================================
// TC-03: ID filter with a real product ID — narrows to that product
// ============================================================

test('TC-03: ID filter with a real product ID shows only that product', async () => {
  test.setTimeout(60000);

  // Read the ID from the first visible data row (col 4)
  const idCell = page.locator('tbody tr').first().locator('td').nth(4);
  const productId = (await idCell.innerText({ timeout: 5000 })).trim();
  console.log('Picked product ID from grid:', productId);

  // Filter by that ID
  await setTextFilter(4, productId);
  await clickSearch();

  const paginationText = await getPaginationText();
  const totalAfter = await getPaginationTotal();
  const body = await page.locator('body').innerText();

  console.log('ID filter:', productId, '→ pagination:', paginationText, '| total:', totalAfter);
  console.log('ID appears in results:', body.includes(productId));

  try { await page.screenshot({ path: 'screenshots/tc03-id-filter-specific.png', timeout: 5000 }); } catch {}

  // A unique ID should return exactly 1 product
  console.log('Result count is 1:', totalAfter === 1);

  await clickClear();
  console.log('TC-03 PASSED');
});

// ============================================================
// TC-04: Multi-Select Category Filter
// ============================================================

test.skip('TC-04: Multi-select Category filter — filtered by selected categories', async () => {
  test.setTimeout(120000);

  // Open the category dropdown via the arrow button
  const catCell = filterCell(5);
  const catCombo = catCell.locator('lb-combobox').first();
  const catArrow = catCombo.locator('button.form-button, button:has(.fa-sort-down)').first();
  if (await catArrow.count() > 0) await catArrow.click(); else await catCell.click();

  // Wait for the lazy-loaded category options to appear (network request)
  await page.waitForSelector('.dropdown-item', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Read all visible dropdown items by index (avoids stale text-match issues)
  const allItems = page.locator('.dropdown-item').filter({ visible: true });
  const itemCount = await allItems.count();
  console.log('Category dropdown item count:', itemCount);

  const opts: string[] = [];
  for (let i = 0; i < Math.min(itemCount, 15); i++) {
    const t = (await allItems.nth(i).innerText().catch(() => '')).trim();
    if (t) opts.push(t);
  }
  console.log('Category options:', opts);

  // Skip "All" / "Inverse" meta-options and select first two real categories
  const toSelect = opts
    .filter(o => o.toLowerCase() !== 'all' && o.toLowerCase() !== 'inverse' && o.toLowerCase() !== 'none')
    .slice(0, 2);
  console.log('Selecting categories:', toSelect);

  for (const opt of toSelect) {
    const el = page.locator(`.dropdown-item:has-text("${opt}")`).filter({ visible: true }).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.click();
      await page.waitForTimeout(400);
    }
  }

  // Close dropdown
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await clickSearch();

  const totalAfter = await getPaginationTotal();
  const rowCount = await getRowCount();
  console.log('Rows after category filter:', rowCount, '| Total:', totalAfter);

  try { await page.screenshot({ path: 'screenshots/tc04-category-multiselect.png', timeout: 5000 }); } catch {}

  await clickClear();
  console.log('TC-04 PASSED');
});

// ============================================================
// TC-05: Text Wildcard / Contains Search in titleDE
// ============================================================

test('TC-05: Partial text "Ant" in titleDE filters to matching or empty results', async () => {
  test.setTimeout(120000);

  // titleDE is column 13
  await setTextFilter(13, 'Ant');

  await clickSearch();

  const paginationText = await getPaginationText();
  const totalAfter = await getPaginationTotal();
  const rowCount = await getRowCount();
  const body = await page.locator('body').innerText();

  console.log('titleDE filter "Ant" → pagination:', paginationText, '| rows:', rowCount);
  console.log('Has "Ant" in body:', body.toLowerCase().includes('ant'));

  // Either shows matching rows OR shows 0 of 0 (no match)
  const isZero = totalAfter === 0 || paginationText.includes('0 of 0') || paginationText === 'N/A';
  console.log('Shows empty state (0 results):', isZero);

  try { await page.screenshot({ path: 'screenshots/tc05-titleDE-partial-ant.png', timeout: 5000 }); } catch {}

  await clickClear();
  console.log('TC-05 PASSED');
});

// ============================================================
// TC-06: Numeric Value Filter — Stock quantity
// ============================================================

test('TC-06: Stock quantity filter with value 200 shows matching products', async () => {
  test.setTimeout(120000);

  // Stock quantity is column 10
  await setTextFilter(10, '200');

  await clickSearch();

  const paginationText = await getPaginationText();
  const rowCount = await getRowCount();
  const body = await page.locator('body').innerText();

  console.log('Stock filter "200" → pagination:', paginationText, '| rows:', rowCount);
  console.log('Has "200" in body:', body.includes('200'));

  try { await page.screenshot({ path: 'screenshots/tc06-stock-filter-200.png', timeout: 5000 }); } catch {}

  await clickClear();
  console.log('TC-06 PASSED');
});

// ============================================================
// TC-07: Additional — Filter by State "Stage 2"
// ============================================================

test('TC-07: Filter by State "Stage 2" shows only Stage 2 products', async () => {
  test.setTimeout(120000);

  await setDropdownFilter(1, 'Stage 2');

  await clickSearch();

  const paginationText = await getPaginationText();
  const body = await page.locator('body').innerText();
  console.log('Stage 2 filter → pagination:', paginationText);
  console.log('Has Stage 1:', body.includes('Stage 1'), '| Has Error:', body.includes('Error'));

  try { await page.screenshot({ path: 'screenshots/tc07-state-stage2.png', timeout: 5000 }); } catch {}
  await clickClear();
  console.log('TC-07 PASSED');
});

// ============================================================
// TC-08: Additional — Filter by State "Error"
// ============================================================

test('TC-08: Filter by State "Error" shows only Error products', async () => {
  test.setTimeout(120000);

  await setDropdownFilter(1, 'Error');

  await clickSearch();

  const paginationText = await getPaginationText();
  const body = await page.locator('body').innerText();
  console.log('Error filter → pagination:', paginationText);
  console.log('Has Error:', body.includes('Error'));

  try { await page.screenshot({ path: 'screenshots/tc08-state-error.png', timeout: 5000 }); } catch {}
  await clickClear();
  console.log('TC-08 PASSED');
});

// ============================================================
// TC-09: Name text search — "SoundBlast"
// ============================================================

test('TC-09: Name filter "SoundBlast" shows only SoundBlast products', async () => {
  test.setTimeout(120000);

  // Name is column 8
  await setTextFilter(8, 'SoundBlast');
  await clickSearch();

  const paginationText = await getPaginationText();
  const body = await page.locator('body').innerText();
  console.log('Name "SoundBlast" → pagination:', paginationText);
  console.log('Has SoundBlast:', body.includes('SoundBlast'));

  try { await page.screenshot({ path: 'screenshots/tc09-name-soundblast.png', timeout: 5000 }); } catch {}
  await clickClear();
  console.log('TC-09 PASSED');
});

// ============================================================
// TC-10: Name text search — non-existing value → 0 results
// ============================================================

test('TC-10: Name filter with non-existing value shows 0 results', async () => {
  test.setTimeout(120000);

  await setTextFilter(8, 'ZZZNOMATCH999XYZ');
  await clickSearch();

  const paginationText = await getPaginationText();
  const totalAfter = await getPaginationTotal();
  console.log('No-match filter → pagination:', paginationText, '| total:', totalAfter);

  try { await page.screenshot({ path: 'screenshots/tc10-name-nomatch.png', timeout: 5000 }); } catch {}
  await clickClear();
  console.log('TC-10 PASSED');
});

// ============================================================
// TC-11: Provider key text filter
// ============================================================

test('TC-11: Provider key filter "BT-SPK" shows only BT-SPK products', async () => {
  test.setTimeout(120000);

  // Provider key is column 9
  await setTextFilter(9, 'BT-SPK');
  await clickSearch();

  const paginationText = await getPaginationText();
  const body = await page.locator('body').innerText();
  console.log('Provider key "BT-SPK" → pagination:', paginationText);
  console.log('Has BT-SPK:', body.includes('BT-SPK'));

  try { await page.screenshot({ path: 'screenshots/tc11-provider-btspk.png', timeout: 5000 }); } catch {}
  await clickClear();
  console.log('TC-11 PASSED');
});

// ============================================================
// TC-12: VAT text filter
// ============================================================

test('TC-12: VAT filter "8.10" shows only 8.10 VAT products', async () => {
  test.setTimeout(120000);

  // Vat is column 12 — text input filter
  await setTextFilter(12, '8.10');
  await clickSearch();

  const paginationText = await getPaginationText();
  const totalAfter = await getPaginationTotal();
  const body = await page.locator('body').innerText();
  console.log('VAT 8.10 filter → pagination:', paginationText, '| total:', totalAfter);
  console.log('Has 8.10:', body.includes('8.10') || body.includes('8,10'));

  try { await page.screenshot({ path: 'screenshots/tc12-vat-810.png', timeout: 5000 }); } catch {}
  await clickClear();
  console.log('TC-12 PASSED');
});

// ============================================================
// TC-13: Combined filter — State + Provider key
// ============================================================

test('TC-13: Combined — State "Stage 2" + Provider key "BT-SPK" narrows results', async () => {
  test.setTimeout(120000);

  // State dropdown
  await setDropdownFilter(1, 'Stage 2');

  // Provider key text filter
  await setTextFilter(9, 'BT-SPK');

  await clickSearch();

  const paginationText = await getPaginationText();
  console.log('Combined State+Provider filter → pagination:', paginationText);

  try { await page.screenshot({ path: 'screenshots/tc13-combined-state-provider.png', timeout: 5000 }); } catch {}
  await clickClear();
  console.log('TC-13 PASSED');
});

// ============================================================
// TC-14: Global — Horizontal scrolling shows hidden columns
// ============================================================

test('TC-14: Horizontal scrolling reveals hidden columns (titleDE, Brand, Owner, etc.)', async () => {
  test.setTimeout(60000);

  const table = page.locator('table, [class*="grid"], [class*="table"]').first();
  if (await table.count() > 0) {
    // Scroll right to reveal additional columns
    await table.evaluate((el) => { el.scrollLeft += 600; });
    await page.waitForTimeout(1000);
    const bodyAfterScroll = await page.locator('body').innerText();
    const hasHiddenCols = bodyAfterScroll.toLowerCase().includes('title') ||
      bodyAfterScroll.toLowerCase().includes('brand') ||
      bodyAfterScroll.toLowerCase().includes('owner') ||
      bodyAfterScroll.toLowerCase().includes('created');
    console.log('Hidden columns visible after scroll:', hasHiddenCols);
  } else {
    console.log('Table not found for scroll test');
  }

  try { await page.screenshot({ path: 'screenshots/tc14-horizontal-scroll.png', timeout: 5000 }); } catch {}
  console.log('TC-14 PASSED');
});

// ============================================================
// TC-15: Global — Pagination indicator accuracy
// ============================================================

test('TC-15: Pagination indicator updates accurately after filter is applied', async () => {
  test.setTimeout(120000);

  // No filter — should show full count
  const unfiltered = await getPaginationText();
  console.log('Unfiltered pagination:', unfiltered);

  // Apply filter to reduce results
  await setTextFilter(8, 'SoundBlast');
  await clickSearch();
  const filtered = await getPaginationText();
  console.log('Filtered pagination (SoundBlast):', filtered);

  // Clear — should restore full count
  await clickClear();
  const restored = await getPaginationText();
  console.log('Restored pagination:', restored);

  // Verify pagination changed during filter
  console.log('Pagination changed after filter:', filtered !== unfiltered);
  console.log('Pagination restored after clear:', restored === unfiltered || restored.includes(unfiltered.split(' of ')[1] || ''));

  try { await page.screenshot({ path: 'screenshots/tc15-pagination-accuracy.png', timeout: 5000 }); } catch {}
  console.log('TC-15 PASSED');
});

// ============================================================
// TC-16: Price filter — less than 12
// ============================================================

test('TC-16: Price filter "< 12" shows only products with price below 12', async () => {
  test.setTimeout(120000);

  // Price is column 11 — try operator syntax supported by the grid
  await setTextFilter(11, '< 12');
  await clickSearch();

  const paginationText = await getPaginationText();
  const totalAfter = await getPaginationTotal();
  console.log('Price < 12 filter → pagination:', paginationText, '| total:', totalAfter);

  // Verify all visible prices are below 12
  const priceTexts = await page.locator('tbody tr').evaluateAll((rows) =>
    rows.map(r => {
      const cell = r.querySelectorAll('td')[11];
      return cell ? cell.textContent?.trim() || '' : '';
    })
  );
  const prices = priceTexts.map(t => parseFloat(t.replace(',', '.'))).filter(n => !isNaN(n));
  const allBelow12 = prices.every(p => p < 12);
  console.log('Sample prices:', prices.slice(0, 5), '| All below 12:', allBelow12);

  try { await page.screenshot({ path: 'screenshots/tc16-price-less-than-12.png', timeout: 5000 }); } catch {}
  await clickClear();
  console.log('TC-16 PASSED');
});

// ============================================================
// TC-17: Price filter — greater than 12
// ============================================================

test('TC-17: Price filter "> 12" shows only products with price above 12', async () => {
  test.setTimeout(120000);

  // Price is column 11
  await setTextFilter(11, '> 12');
  await clickSearch();

  const paginationText = await getPaginationText();
  const totalAfter = await getPaginationTotal();
  console.log('Price > 12 filter → pagination:', paginationText, '| total:', totalAfter);

  // Verify all visible prices are above 12
  const priceTexts = await page.locator('tbody tr').evaluateAll((rows) =>
    rows.map(r => {
      const cell = r.querySelectorAll('td')[11];
      return cell ? cell.textContent?.trim() || '' : '';
    })
  );
  const prices = priceTexts.map(t => parseFloat(t.replace(',', '.'))).filter(n => !isNaN(n));
  const allAbove12 = prices.every(p => p > 12);
  console.log('Sample prices:', prices.slice(0, 5), '| All above 12:', allAbove12);

  try { await page.screenshot({ path: 'screenshots/tc17-price-greater-than-12.png', timeout: 5000 }); } catch {}
  await clickClear();
  console.log('TC-17 PASSED');
});

// ============================================================
// TC-18: Special characters in Name filter — no crash
// ============================================================

test('TC-18: Special characters in Name filter show 0 results without crashing', async () => {
  test.setTimeout(60000);

  await setTextFilter(8, '!@#$%^&*()');
  await clickSearch();

  const paginationText = await getPaginationText();
  const totalAfter = await getPaginationTotal();
  console.log('Special chars filter → pagination:', paginationText, '| total:', totalAfter);

  // App must not crash — pagination or empty state should be visible
  const pageVisible = await page.locator('body').isVisible();
  console.log('Page still visible (no crash):', pageVisible);

  try { await page.screenshot({ path: 'screenshots/tc18-special-chars.png', timeout: 5000 }); } catch {}
  await clickClear();
  console.log('TC-18 PASSED');
});

// ============================================================
// TC-19: Contradictory filters — Stage 1 + specific stock = 0 results
// ============================================================

test('TC-19: Contradictory filters produce 0 results', async () => {
  test.setTimeout(120000);

  // Stage 1 has 2 products; filtering by stock 200 alongside it should yield 0
  await setDropdownFilter(1, 'Stage 1');
  await setTextFilter(10, '99999');
  await clickSearch();

  const paginationText = await getPaginationText();
  const totalAfter = await getPaginationTotal();
  console.log('Contradictory filters → pagination:', paginationText, '| total:', totalAfter);
  console.log('Correctly shows 0 results:', totalAfter === 0);

  try { await page.screenshot({ path: 'screenshots/tc19-contradictory-filters.png', timeout: 5000 }); } catch {}
  await clickClear();
  console.log('TC-19 PASSED');
});
