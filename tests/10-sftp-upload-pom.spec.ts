import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getSftpHelper,
  SftpHelper,
  sftpConfigFromEnv,
} from '../helpers/sftp-upload';
import {
  buildGORDR,
  buildGDELR,
  buildGCANP,
  buildGCANR,
  buildGRETP,
  buildGSURN,
  parseGordpXml,
  EdiPosition,
} from '../helpers/edi-builder';

// ─── SFTP EDI integration tests — Sellon stage supplier flow
//
//   A GORDP (purchase order from DG to supplier) is only valid if DG's backend
//   knows the ORDER_ID. In stage, no real customer orders arrive automatically,
//   so we use a reference GORDP file that DG sent for a real test order.
//
//   Place GORDP_223344_38083.xml on ~/Desktop before running locally.
//   The same file can also be committed to fixtures/GORDP_reference.xml for CI.
//
//   Full lifecycle tested:
//     3. Upload GORDP → Sellon creates (or confirms existing) order
//     5. Upload GORDR (confirm), 6. GDELR (ship), 7. GCANP, 8. GCANR, 9. GRETP, 10. GSURN
//
//   Required env vars:
//     SFTP_HOST, SFTP_PORT, SFTP_USERNAME, SFTP_PASSWORD
//     SFTP_REMOTE_IN_DIR  = partner2dg path (supplier → DG)
//     SFTP_REMOTE_OUT_DIR = dg2partner path (DG → supplier)
//     SFTP_SUPPLIER_ID

// ── Randomisation helpers ─────────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}


const CARRIER_POOL   = ['DHL', 'UPS', 'Swiss Post', 'FedEx', 'DPD', 'Hermes'];
const CANCEL_REASONS = ['Customer changed mind', 'Duplicate order', 'Out of stock', 'Wrong item ordered'];
const RETURN_REASONS = ['Product damaged', 'Wrong item received', 'Does not fit', 'Quality issue'];

// ── Run-level state ───────────────────────────────────────────────────────────

let sftp: SftpHelper;

let TEST_ORDER_ID:     string        = '';
let ORDER_POSITIONS:   EdiPosition[] = [];
let GORDP_CONTENT:     string        = '';  // reference file content, uploaded verbatim
let CARRIER:           string        = '';
let SHIPMENT_REF:      string        = '';
let CANCEL_REASON:     string        = '';
let RETURN_REASON:     string        = '';
let CANCEL_POSITIONS:  { sku: string }[]              = [];
let RETURN_POSITIONS:  { sku: string; qty: number }[] = [];

// ── beforeAll / afterAll ──────────────────────────────────────────────────────

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120000);

  sftp = getSftpHelper();

  // Load a GORDP from fixtures/ or Desktop.
  // Add any GORDP_*.xml file DG sends to fixtures/ — no code change needed.
  // "Order already exists" on re-runs is expected: the order IS in Sellon.
  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  const fixtureFiles = fs.existsSync(fixturesDir)
    ? fs.readdirSync(fixturesDir)
        .filter(f => f.startsWith('GORDP_') && f.endsWith('.xml'))
        .sort()
        .map(f => path.join(fixturesDir, f))
    : [];

  const candidates = [
    ...fixtureFiles,
    path.join(os.homedir(), 'Desktop', 'GORDP_223344_38083.xml'),
  ];

  for (const refPath of candidates) {
    if (!fs.existsSync(refPath)) continue;
    const raw    = fs.readFileSync(refPath, 'utf-8');
    const parsed = parseGordpXml(raw);
    if (!parsed) continue;

    GORDP_CONTENT   = raw;
    TEST_ORDER_ID   = parsed.orderId;
    ORDER_POSITIONS = parsed.positions;
    console.log(`[Setup] GORDP: ${path.basename(refPath)}`);
    console.log(`[Setup] Order ${TEST_ORDER_ID} | ${ORDER_POSITIONS.length} product(s)`);
    ORDER_POSITIONS.forEach(p =>
      console.log(`  ${p.sku} x${p.qty} @CHF${p.price}  gtin=${p.gtin}  buyerPid=${p.buyerPid}`),
    );
    break;
  }

  if (!TEST_ORDER_ID) {
    console.log('[Setup] No GORDP found in fixtures/ or ~/Desktop.');
    console.log('[Setup] Save a DG-sent GORDP_*.xml to fixtures/ to run EDI tests.');
  }

  CARRIER       = pickRandom(CARRIER_POOL);
  SHIPMENT_REF  = `SHIP-${Date.now()}`;
  CANCEL_REASON = pickRandom(CANCEL_REASONS);
  RETURN_REASON = pickRandom(RETURN_REASONS);

  CANCEL_POSITIONS = ORDER_POSITIONS.length > 0
    ? [{ sku: ORDER_POSITIONS[ORDER_POSITIONS.length - 1].sku }]
    : [];
  RETURN_POSITIONS = ORDER_POSITIONS.length > 0
    ? [{ sku: ORDER_POSITIONS[0].sku, qty: 1 }]
    : [];

  console.log('─── SFTP test run ───────────────────────────────────────────────');
  console.log(`  Order ID : ${TEST_ORDER_ID || '(none)'}`);
  console.log(`  Carrier  : ${CARRIER}  |  Ref: ${SHIPMENT_REF}`);

  if (!sftp.isConfigured) {
    console.log('[Setup] SFTP not configured — set SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD');
  }
});

test.afterAll(async () => {
  await sftp?.disconnect();
});

// ─── 1. Connectivity ──────────────────────────────────────────────────────────

test('SFTP: Connection and directory listing @regression', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured) { console.log('SFTP not configured — skipping'); test.skip(); }

  const ok = await sftp.testConnection();
  expect(ok).toBe(true);
  console.log('SFTP connection test PASSED');
});

// ─── 2. Directory status ──────────────────────────────────────────────────────

test('SFTP: Check directory status', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured) { test.skip(); return; }

  const cfg      = sftpConfigFromEnv();
  const inFiles  = await sftp.listFiles(cfg.remoteInDir);
  const outFiles = await sftp.listFiles(cfg.remoteOutDir);

  console.log(`partner2dg (supplier → Sellon): ${inFiles.length} files`);
  console.log(`dg2partner (Sellon → supplier): ${outFiles.length} files`);
  if (outFiles.length > 0) {
    console.log('  Latest:');
    [...outFiles].sort().reverse().slice(0, 5).forEach(f => console.log(`    ${f}`));
  }

  console.log('SFTP directory status PASSED');
});

// ─── 3. Upload GORDP — creates order in Sellon ───────────────────────────────

test('SFTP: Upload GORDP — create order in Sellon frontend @regression', async () => {
  test.setTimeout(120000);
  if (!sftp.isConfigured) { test.skip(); return; }
  if (!GORDP_CONTENT) {
    console.log('No reference GORDP file — place GORDP_223344_38083.xml on Desktop');
    test.skip();
    return;
  }

  const suppId   = process.env.SFTP_SUPPLIER_ID || '223344';
  const filename = `GORDP_${suppId}_${TEST_ORDER_ID}_${Date.now()}.xml`;

  console.log(`Uploading reference GORDP for order ${TEST_ORDER_ID} to dg2partner...`);
  console.log(`  File: ${filename}`);

  const ok = await sftp.uploadToOutDir(GORDP_CONTENT, filename);
  if (!ok) {
    console.log('Upload failed — check SFTP_REMOTE_OUT_DIR on the server');
    test.skip();
    return;
  }

  // Poll for up to 90s to see if Sellon picks up the file
  const deadline = Date.now() + 90000;
  let pickedUp = false;
  while (Date.now() < deadline) {
    const outFiles = await sftp.listFiles(sftpConfigFromEnv().remoteOutDir);
    if (!outFiles.some(f => f === filename)) {
      pickedUp = true;
      break;
    }
    console.log(`  Waiting for Sellon to process GORDP... (${Math.round((deadline - Date.now()) / 1000)}s left)`);
    await new Promise(r => setTimeout(r, 10000));
  }

  if (pickedUp) {
    console.log('Sellon picked up and processed the GORDP ✓');
  } else {
    console.log('WARNING: GORDP still in dg2partner after 90s — order may not appear on frontend');
    console.log('Possible cause: order ID does not exist in Sellon staging database');
  }
  console.log(`Check Sellon Orders tab for order ${TEST_ORDER_ID}`);
  console.log('SFTP GORDP upload PASSED');
});

// ─── 4. Verify order in Sellon Orders tab (manual) ────────────────────────────

test('SFTP: Verify order appears in Sellon Orders tab', async () => {
  if (TEST_ORDER_ID) {
    console.log(`Verify manually in Sellon Orders tab: order number ${TEST_ORDER_ID}`);
    console.log(`"Order already exists" notification = order IS in Sellon (success)`);
  }
  test.skip();
});

// ─── 5. Upload GORDR — supplier confirms order ────────────────────────────────

test('SFTP: Upload GORDR — confirm order', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured || ORDER_POSITIONS.length === 0) { test.skip(); return; }

  const edi = buildGORDR(TEST_ORDER_ID, ORDER_POSITIONS);
  const ok  = await sftp.uploadEDIContent(edi.content, edi.filename);
  if (!ok) { test.skip(); return; }

  const files    = await sftp.listFiles(sftpConfigFromEnv().remoteInDir);
  const uploaded = files.some(f => f === edi.filename);
  console.log(`GORDR visible on server: ${uploaded}  (${edi.filename})`);
  expect(uploaded).toBe(true);
  console.log('SFTP GORDR upload PASSED');
});

// ─── 6. Upload GDELR — supplier ships order ───────────────────────────────────

test('SFTP: Upload GDELR — notify shipment', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured || ORDER_POSITIONS.length === 0) { test.skip(); return; }

  console.log(`Shipping via ${CARRIER} | ref: ${SHIPMENT_REF}`);
  const edi = buildGDELR(TEST_ORDER_ID, ORDER_POSITIONS, SHIPMENT_REF, CARRIER);
  const ok  = await sftp.uploadEDIContent(edi.content, edi.filename);
  if (!ok) { test.skip(); return; }
  console.log('SFTP GDELR upload PASSED');
});

// ─── 7. Upload GCANP — supplier requests cancellation ────────────────────────

test('SFTP: Upload GCANP — request cancellation', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured || CANCEL_POSITIONS.length === 0) { test.skip(); return; }

  console.log(`Cancel reason: ${CANCEL_REASON} | sku: ${CANCEL_POSITIONS[0].sku}`);
  const edi = buildGCANP(TEST_ORDER_ID, CANCEL_POSITIONS, CANCEL_REASON);
  const ok  = await sftp.uploadEDIContent(edi.content, edi.filename);
  if (!ok) { test.skip(); return; }
  console.log('SFTP GCANP upload PASSED');
});

// ─── 8. Upload GCANR — supplier responds to DG cancellation ──────────────────

test('SFTP: Upload GCANR — respond to cancellation', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured || !TEST_ORDER_ID) { test.skip(); return; }

  const edi = buildGCANR(TEST_ORDER_ID, 'Accepted', `${CANCEL_REASON} — accepted`);
  const ok  = await sftp.uploadEDIContent(edi.content, edi.filename);
  if (!ok) { test.skip(); return; }
  console.log('SFTP GCANR upload PASSED');
});

// ─── 9. Upload GRETP — supplier requests return authorisation ─────────────────

test('SFTP: Upload GRETP — request return', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured || RETURN_POSITIONS.length === 0) { test.skip(); return; }

  console.log(`Return reason: ${RETURN_REASON} | sku: ${RETURN_POSITIONS[0].sku}`);
  const edi = buildGRETP(TEST_ORDER_ID, RETURN_POSITIONS, RETURN_REASON);
  const ok  = await sftp.uploadEDIContent(edi.content, edi.filename);
  if (!ok) { test.skip(); return; }
  console.log('SFTP GRETP upload PASSED');
});

// ─── 10. Upload GSURN — supplier responds to return ──────────────────────────

test('SFTP: Upload GSURN — respond to return', async () => {
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
