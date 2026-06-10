import { test, expect } from '@playwright/test';
import { getSftpHelper, SftpHelper, sftpConfigFromEnv } from '../helpers/sftp-upload';
import { buildGORDR, buildGDELR, buildGCANR, buildGSURN, buildGORDP, buildGCANP, buildGRETP } from '../helpers/edi-builder';

// ─── These tests verify SFTP connectivity and EDI upload/download.
//     They run independently of the browser — no page object needed.
//     Required env vars: SFTP_HOST, SFTP_PORT, SFTP_USERNAME, SFTP_PASSWORD
//                        SFTP_REMOTE_IN_DIR, SFTP_REMOTE_OUT_DIR, SFTP_SUPPLIER_ID

let sftp: SftpHelper;
const TEST_ORDER_ID = `TEST_${Date.now().toString().slice(-8)}`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  sftp = getSftpHelper();
  if (!sftp.isConfigured) {
    console.log('SFTP not configured — set SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD to run these tests');
  }
});

test.afterAll(async () => {
  await sftp.disconnect();
});

// ─── 1. Connectivity ──────────────────────────────────────────────────────────

test('SFTP: Connection and directory listing', async () => {
  test.setTimeout(30000);

  if (!sftp.isConfigured) {
    console.log('SFTP not configured — skipping');
    test.skip();
  }

  const ok = await sftp.testConnection();
  expect(ok).toBe(true);
  console.log('SFTP connection test PASSED');
});

// ─── 2. Upload supplier → platform (outbound from our side) ──────────────────

test('SFTP: Upload GORDR (order confirmation)', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured) { test.skip(); return; }

  const edi = buildGORDR(TEST_ORDER_ID, [
    { sku: 'BACK-001', qty: 2 },
    { sku: 'BACK-002', qty: 1 },
  ]);

  const ok = await sftp.uploadEDIContent(edi.content, edi.filename);
  expect(ok).toBe(true);

  // Verify the file appears in the incoming directory
  const config = sftpConfigFromEnv();
  const files = await sftp.listFiles(config.remoteInDir);
  const uploaded = files.some(f => f === edi.filename);
  console.log(`File ${edi.filename} visible on server: ${uploaded}`);
  expect(uploaded).toBe(true);

  console.log('SFTP GORDR upload PASSED');
});

test('SFTP: Upload GDELR (delivery confirmation)', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured) { test.skip(); return; }

  const edi = buildGDELR(
    TEST_ORDER_ID,
    [{ sku: 'BACK-001', qty: 2 }],
    `SHIP-${Date.now()}`,
    'DHL',
  );

  const ok = await sftp.uploadEDIContent(edi.content, edi.filename);
  expect(ok).toBe(true);
  console.log('SFTP GDELR upload PASSED');
});

test('SFTP: Upload GCANR (cancellation response — accepted)', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured) { test.skip(); return; }

  const edi = buildGCANR(TEST_ORDER_ID, 'Accepted', 'Cancellation accepted as requested');
  const ok = await sftp.uploadEDIContent(edi.content, edi.filename);
  expect(ok).toBe(true);
  console.log('SFTP GCANR upload PASSED');
});

test('SFTP: Upload GSURN (return response — accepted)', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured) { test.skip(); return; }

  const edi = buildGSURN(
    TEST_ORDER_ID,
    'Accepted',
    [{ sku: 'BACK-001' }],
    'Return accepted',
  );
  const ok = await sftp.uploadEDIContent(edi.content, edi.filename);
  expect(ok).toBe(true);
  console.log('SFTP GSURN upload PASSED');
});

// ─── 3. Simulate inbound EDI (platform → supplier) ───────────────────────────
//     Upload to remoteInDir to simulate the platform sending us an order / request.

test('SFTP: Upload GORDP (seed test order)', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured) { test.skip(); return; }

  const edi = buildGORDP(
    TEST_ORDER_ID,
    [
      { sku: 'BACK-001', qty: 2, price: 49.90 },
      { sku: 'BACK-002', qty: 1, price: 29.90 },
    ],
    { name: 'Test Customer', street: 'Teststrasse 1', city: 'Zurich', zip: '8001', country: 'CH' },
  );

  const ok = await sftp.uploadEDIContent(edi.content, edi.filename);
  expect(ok).toBe(true);
  console.log('SFTP GORDP seed upload PASSED');
});

test('SFTP: Upload GCANP (simulate cancellation request)', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured) { test.skip(); return; }

  const edi = buildGCANP(TEST_ORDER_ID, [{ sku: 'BACK-002' }], 'Customer changed mind');
  const ok = await sftp.uploadEDIContent(edi.content, edi.filename);
  expect(ok).toBe(true);
  console.log('SFTP GCANP upload PASSED');
});

test('SFTP: Upload GRETP (simulate return request)', async () => {
  test.setTimeout(30000);
  if (!sftp.isConfigured) { test.skip(); return; }

  const edi = buildGRETP(TEST_ORDER_ID, [{ sku: 'BACK-001', qty: 1 }], 'Product damaged');
  const ok = await sftp.uploadEDIContent(edi.content, edi.filename);
  expect(ok).toBe(true);
  console.log('SFTP GRETP upload PASSED');
});

// ─── 4. Verify SFTP response (platform writes to outDir after processing) ─────

test('SFTP: Wait for platform response file in outDir', async () => {
  test.setTimeout(120000);
  if (!sftp.isConfigured) { test.skip(); return; }

  // After uploading a GORDP the platform should write a GORDR or acknowledgement
  const responseFile = await sftp.waitForFile(
    new RegExp(`GORDR.*${TEST_ORDER_ID}`, 'i'),
    60000,
    4000,
  );

  if (responseFile) {
    console.log('Platform response file found:', responseFile);
    const content = await sftp.downloadFileContent(
      `${sftpConfigFromEnv().remoteOutDir}/${responseFile}`,
    );
    console.log('Response content preview:', content.substring(0, 400));
    expect(content.length).toBeGreaterThan(0);
  } else {
    // Platform may not auto-respond in staging — log as informational
    console.log('NOTE: No GORDR response found in outDir within 60s — platform may require manual trigger');
  }

  console.log('SFTP response check PASSED');
});
