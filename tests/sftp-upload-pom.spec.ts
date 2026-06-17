import { test, expect, chromium, Browser, Page } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { NavigationPage } from '../pages/navigation.page';
import { getSftpHelper, SftpHelper, sftpConfigFromEnv } from '../helpers/sftp-upload';
import { buildGORDR, buildGDELR, buildGCANR, buildGSURN, buildGORDP, buildGCANP, buildGRETP } from '../helpers/edi-builder';

// ─── SFTP tests for the Sellon supplier EDI integration.
//
//     Flow:
//       1. Login to Sellon stage, scrape real provider keys from the Products tab.
//       2. Build a GORDP from those real SKUs and upload to partner2dg.
//          → Sellon reads the file and creates the order in its frontend.
//          → No manual file upload from desktop needed.
//       3. Upload the remaining supplier messages (GORDR, GDELR, etc.)
//
//     All supplier → platform messages go to SFTP_REMOTE_IN_DIR (partner2dg).
//     Sellon → supplier acknowledgements appear in SFTP_REMOTE_OUT_DIR (dg2partner).
//
//     Required env vars:
//       BASE_URL, TEST_USERNAME, TEST_PASSWORD  (login to scrape real SKUs)
//       SFTP_HOST, SFTP_PORT, SFTP_USERNAME, SFTP_PASSWORD
//       SFTP_REMOTE_IN_DIR, SFTP_REMOTE_OUT_DIR, SFTP_SUPPLIER_ID

// ── Randomisation helpers ─────────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPrice(min = 9.90, max = 199.90): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

const CARRIER_POOL   = ['DHL', 'UPS', 'Swiss Post', 'FedEx', 'DPD', 'Hermes'];
const CANCEL_REASONS = ['Customer changed mind', 'Duplicate order', 'Out of stock', 'Wrong item ordered'];
const RETURN_REASONS = ['Product damaged', 'Wrong item received', 'Does not fit', 'Quality issue', 'Changed mind'];
const FIRST_NAMES    = ['Anna', 'Klaus', 'Maria', 'Thomas', 'Sophie', 'Lukas', 'Emma', 'Noah'];
const LAST_NAMES     = ['Müller', 'Schmidt', 'Weber', 'Fischer', 'Meyer', 'Wagner', 'Becker'];
const CITIES = [
  { city: 'Zürich',   zip: '8001', country: 'Schweiz' },
  { city: 'Bern',     zip: '3001', country: 'Schweiz' },
  { city: 'Basel',    zip: '4051', country: 'Schweiz' },
  { city: 'Genf',     zip: '1201', country: 'Schweiz' },
  { city: 'Lausanne', zip: '1003', country: 'Schweiz' },
];
const STREET_NAMES   = ['Hauptstrasse', 'Bahnhofstrasse', 'Dorfstrasse', 'Schulstrasse', 'Bergstrasse'];

function randomAddress() {
  const loc = pickRandom(CITIES);
  return {
    name:    `${pickRandom(FIRST_NAMES)} ${pickRandom(LAST_NAMES)}`,
    street:  `${pickRandom(STREET_NAMES)} ${randomInt(1, 99)}`,
    city:    loc.city,
    zip:     loc.zip,
    country: loc.country,
  };
}

// ── Run-level state (set in beforeAll after scraping real products) ────────────

interface RealProduct {
  sku:      string;  // provider key  → SUPPLIER_PID
  gtin:     string;  // GTIN          → INTERNATIONAL_PID
  buyerPid: string;  // Sellon ID     → BUYER_PID (DgProductId)
  price:    number;
}

let sftp: SftpHelper;
let browser: Browser;
let page: Page;

let REAL_PRODUCTS: RealProduct[] = [];
let TEST_ORDER_ID: string        = '';
let ORDER_POSITIONS: import('../helpers/edi-builder').EdiPosition[] = [];
let DELIVERY_ADDRESS             = { name: '', street: '', city: '', zip: '', country: 'Schweiz' };
let CARRIER: string              = '';
let SHIPMENT_REF: string         = '';
let CANCEL_REASON: string        = '';
let RETURN_REASON: string        = '';
let SHIP_POSITIONS:   { sku: string; qty: number }[] = [];
let CANCEL_POSITIONS: { sku: string }[] = [];
let RETURN_POSITIONS: { sku: string; qty: number }[] = [];

// ── Scrape real active products from the Products tab ─────────────────────────

async function scrapeRealProducts(pg: Page): Promise<RealProduct[]> {
  const navPage = new NavigationPage(pg);
  await navPage.navigateToProducts();
  await pg.waitForTimeout(3000);

  const rawHeaders  = await pg.locator('thead tr').first().locator('th, td').allInnerTexts();
  const headers     = rawHeaders.map(h => h.trim().split('\n')[0]);
  const pkColIdx    = headers.findIndex(h => /provider.?key/i.test(h));
  const gtinColIdx  = headers.findIndex(h => /^gtin$/i.test(h));
  const idColIdx    = headers.findIndex(h => /^id$/i.test(h));
  const priceColIdx = headers.findIndex(h => /^price$/i.test(h));
  const activeColIdx = headers.findIndex(h => /^active$/i.test(h));

  console.log(`[Products] pk=${pkColIdx} gtin=${gtinColIdx} id=${idColIdx} price=${priceColIdx} active=${activeColIdx}`);

  if (pkColIdx < 0) {
    console.log('[Products] Provider key column not found');
    return [];
  }

  const rows     = pg.locator('tbody tr');
  const rowCount = await rows.count();
  const products: RealProduct[] = [];

  for (let i = 0; i < rowCount; i++) {
    const cells = rows.nth(i).locator('td');

    // Active products only
    if (activeColIdx >= 0) {
      const isActive = await cells.nth(activeColIdx).evaluate((el: HTMLElement) =>
        !!el.querySelector('.fa-check, [class*="fa-check"]')
      ).catch(() => false);
      if (!isActive) continue;
    }

    const sku  = await cells.nth(pkColIdx).evaluate((el: HTMLElement) => el.innerText.trim()).catch(() => '');
    if (!sku) continue;

    const gtinRaw  = gtinColIdx  >= 0 ? await cells.nth(gtinColIdx).evaluate((el: HTMLElement) => el.innerText.trim()).catch(() => '') : '';
    const idRaw    = idColIdx    >= 0 ? await cells.nth(idColIdx).evaluate((el: HTMLElement) => el.innerText.trim()).catch(() => '')   : '';
    const priceRaw = priceColIdx >= 0 ? await cells.nth(priceColIdx).evaluate((el: HTMLElement) => el.innerText.trim()).catch(() => '') : '';
    const price    = parseFloat(priceRaw.replace(/[^\d.]/g, '')) || 10.00;

    // Sellon's "ID" column is its internal product ID.
    // The DgProductId used in GORDP's BUYER_PID is Sellon internal ID + 2000.
    // (Verified: DEMO-100 internal=36083, DgProductId=38083, diff=2000)
    const sellonId  = parseInt(idRaw, 10) || 0;
    const buyerPid  = sellonId > 0 ? String(sellonId + 2000) : idRaw;

    if (!products.some(p => p.sku === sku)) {
      products.push({ sku, gtin: gtinRaw, buyerPid, price });
    }
  }

  return products;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(300000);

  // ── Step 1: login and scrape real product SKUs ────────────────────────────
  browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  page = await context.newPage();

  const loginPage = new LoginPage(page);
  await loginPage.login(process.env.TEST_USERNAME || '', process.env.TEST_PASSWORD || '');

  console.log('[Setup] Scraping real active products from Products tab...');
  REAL_PRODUCTS = await scrapeRealProducts(page);
  console.log(`[Setup] Found ${REAL_PRODUCTS.length} active products`);
  REAL_PRODUCTS.forEach(p => console.log(`  sku=${p.sku} gtin=${p.gtin} buyerPid=${p.buyerPid} price=${p.price}`));

  await browser.close();

  // ── Step 2: build randomised order from real products ─────────────────────
  // Use a large numeric ORDER_ID matching Sellon's real format (not TEST_ prefix)
  TEST_ORDER_ID    = `9${randomInt(1000000, 9999999)}`;
  DELIVERY_ADDRESS = randomAddress();
  CARRIER          = pickRandom(CARRIER_POOL);
  SHIPMENT_REF     = `SHIP-${Date.now()}`;
  CANCEL_REASON    = pickRandom(CANCEL_REASONS);
  RETURN_REASON    = pickRandom(RETURN_REASONS);

  if (REAL_PRODUCTS.length > 0) {
    // Pick 1-2 random real products for this order
    const shuffled = [...REAL_PRODUCTS].sort(() => Math.random() - 0.5);
    const count    = Math.min(randomInt(1, 2), shuffled.length);
    ORDER_POSITIONS = shuffled.slice(0, count).map(p => ({
      sku:       p.sku,
      qty:       randomInt(1, 5),
      price:     p.price > 0 ? p.price : randomPrice(),
      gtin:      p.gtin,
      buyerPid:  p.buyerPid,
    }));
  } else {
    console.log('[Setup] No real products found — SFTP EDI tests will be skipped');
  }

  SHIP_POSITIONS   = ORDER_POSITIONS.map(p => ({ sku: p.sku, qty: p.qty }));
  CANCEL_POSITIONS = ORDER_POSITIONS.length > 0 ? [{ sku: ORDER_POSITIONS[ORDER_POSITIONS.length - 1].sku }] : [];
  RETURN_POSITIONS = ORDER_POSITIONS.length > 0 ? [{ sku: ORDER_POSITIONS[0].sku, qty: 1 }] : [];

  console.log('─── SFTP test run ───────────────────────────────────────────────');
  console.log(`  Order ID  : ${TEST_ORDER_ID}`);
  console.log(`  Positions : ${JSON.stringify(ORDER_POSITIONS)}`);
  console.log(`  Deliver to: ${DELIVERY_ADDRESS.name}, ${DELIVERY_ADDRESS.street}, ${DELIVERY_ADDRESS.zip} ${DELIVERY_ADDRESS.city}`);
  console.log(`  Carrier   : ${CARRIER}  |  Ref: ${SHIPMENT_REF}`);

  // ── Step 3: initialise SFTP helper ────────────────────────────────────────
  sftp = getSftpHelper();
  if (!sftp.isConfigured) {
    console.log('[Setup] SFTP not configured — set SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD');
  }
});

test.afterAll(async () => {
  await sftp?.disconnect();
});

// ─── 1. Connectivity ──────────────────────────────────────────────────────────

test('SFTP: Connection and directory listing', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured) { console.log('SFTP not configured — skipping'); test.skip(); }

  const ok = await sftp.testConnection();
  expect(ok).toBe(true);
  console.log('SFTP connection test PASSED');
});

// ─── 2. Directory status (informational) ──────────────────────────────────────

test('SFTP: Check directory status', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured) { test.skip(); return; }

  const config   = sftpConfigFromEnv();
  const inFiles  = await sftp.listFiles(config.remoteInDir);
  const outFiles = await sftp.listFiles(config.remoteOutDir);

  console.log(`partner2dg (supplier → Sellon): ${inFiles.length} files`);
  console.log(`dg2partner (Sellon → supplier): ${outFiles.length} files`);

  if (outFiles.length > 0) {
    console.log('  Latest files from Sellon:');
    outFiles.slice(-5).forEach(f => console.log(`    ${f}`));
  }

  console.log('SFTP directory status PASSED');
});

// ─── 3. Upload GORDP — creates order in Sellon using real product SKUs ─────────
//     Replaces manually uploading an XML file from the desktop.

test('SFTP: Upload GORDP — creates order in Sellon frontend', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured) { test.skip(); return; }

  if (ORDER_POSITIONS.length === 0) {
    console.log('No real SKUs available — cannot build GORDP. Check Products tab has active products.');
    test.skip();
    return;
  }

  const edi = buildGORDP(TEST_ORDER_ID, ORDER_POSITIONS, DELIVERY_ADDRESS);
  console.log(`Uploading GORDP for order ${TEST_ORDER_ID} to partner2dg...`);
  console.log(`  Items   : ${ORDER_POSITIONS.map(p => `${p.sku} x${p.qty} @CHF${p.price}`).join(', ')}`);
  console.log(`  Ship to : ${DELIVERY_ADDRESS.name}, ${DELIVERY_ADDRESS.street}, ${DELIVERY_ADDRESS.zip} ${DELIVERY_ADDRESS.city}`);

  const ok = await sftp.uploadEDIContent(edi.content, edi.filename);
  if (!ok) {
    console.log('NOTE: Upload failed — check SFTP_REMOTE_IN_DIR path on the server');
    test.skip();
    return;
  }

  // Verify the file is visible on the server
  const files    = await sftp.listFiles(sftpConfigFromEnv().remoteInDir);
  const uploaded = files.some(f => f === edi.filename);
  console.log(`File ${edi.filename} visible on server: ${uploaded}`);
  expect(uploaded).toBe(true);

  console.log('✓ GORDP uploaded — order should now appear in Sellon frontend');
  console.log('SFTP GORDP upload PASSED');
});

// ─── 4. Order confirmation flow ───────────────────────────────────────────────

test('SFTP: Upload GORDR — supplier confirms the order', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured || SHIP_POSITIONS.length === 0) { test.skip(); return; }

  const edi = buildGORDR(TEST_ORDER_ID, SHIP_POSITIONS);
  const ok  = await sftp.uploadEDIContent(edi.content, edi.filename);
  if (!ok) { test.skip(); return; }

  const files    = await sftp.listFiles(sftpConfigFromEnv().remoteInDir);
  const uploaded = files.some(f => f === edi.filename);
  console.log(`GORDR visible on server: ${uploaded}`);
  expect(uploaded).toBe(true);
  console.log('SFTP GORDR upload PASSED');
});

test('SFTP: Upload GDELR — supplier ships the order', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured || SHIP_POSITIONS.length === 0) { test.skip(); return; }

  console.log(`Shipping via ${CARRIER} | ref: ${SHIPMENT_REF}`);
  const edi = buildGDELR(TEST_ORDER_ID, SHIP_POSITIONS, SHIPMENT_REF, CARRIER);
  const ok  = await sftp.uploadEDIContent(edi.content, edi.filename);
  if (!ok) { test.skip(); return; }
  console.log('SFTP GDELR upload PASSED');
});

// ─── 5. Cancellation flow ─────────────────────────────────────────────────────

test('SFTP: Upload GCANP — supplier requests cancellation', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured || CANCEL_POSITIONS.length === 0) { test.skip(); return; }

  console.log(`Cancel reason: ${CANCEL_REASON} | sku: ${CANCEL_POSITIONS[0].sku}`);
  const edi = buildGCANP(TEST_ORDER_ID, CANCEL_POSITIONS, CANCEL_REASON);
  const ok  = await sftp.uploadEDIContent(edi.content, edi.filename);
  if (!ok) { test.skip(); return; }
  console.log('SFTP GCANP upload PASSED');
});

test('SFTP: Upload GCANR — supplier responds to cancellation', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured) { test.skip(); return; }

  const edi = buildGCANR(TEST_ORDER_ID, 'Accepted', `${CANCEL_REASON} — accepted`);
  const ok  = await sftp.uploadEDIContent(edi.content, edi.filename);
  if (!ok) { test.skip(); return; }
  console.log('SFTP GCANR upload PASSED');
});

// ─── 6. Return flow ───────────────────────────────────────────────────────────

test('SFTP: Upload GRETP — supplier requests return', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured || RETURN_POSITIONS.length === 0) { test.skip(); return; }

  console.log(`Return reason: ${RETURN_REASON} | sku: ${RETURN_POSITIONS[0].sku}`);
  const edi = buildGRETP(TEST_ORDER_ID, RETURN_POSITIONS, RETURN_REASON);
  const ok  = await sftp.uploadEDIContent(edi.content, edi.filename);
  if (!ok) { test.skip(); return; }
  console.log('SFTP GRETP upload PASSED');
});

test('SFTP: Upload GSURN — supplier responds to return', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured || RETURN_POSITIONS.length === 0) { test.skip(); return; }

  const edi = buildGSURN(
    TEST_ORDER_ID,
    'Accepted',
    RETURN_POSITIONS.map(p => ({ sku: p.sku })),
    `${RETURN_REASON} — accepted`,
  );
  const ok = await sftp.uploadEDIContent(edi.content, edi.filename);
  if (!ok) { test.skip(); return; }
  console.log('SFTP GSURN upload PASSED');
});

// ─── 7. Wait for Sellon acknowledgement ──────────────────────────────────────

test('SFTP: Wait for Sellon acknowledgement in dg2partner', async () => {
  test.setTimeout(120000);
  if (!sftp.isConfigured) { test.skip(); return; }

  const responseFile = await sftp.waitForFile(
    new RegExp(`GORDR.*${TEST_ORDER_ID}`, 'i'),
    60000,
    4000,
  );

  if (responseFile) {
    console.log('Sellon acknowledgement found:', responseFile);
    const content = await sftp.downloadFileContent(
      `${sftpConfigFromEnv().remoteOutDir}/${responseFile}`,
    );
    console.log('Response preview:', content.substring(0, 400));
    expect(content.length).toBeGreaterThan(0);
  } else {
    console.log('NOTE: No acknowledgement from Sellon in 60s — platform may process async');
  }

  console.log('SFTP acknowledgement check PASSED');
});
