/**
 * Seed script — uploads GORDP files for the 3 fixture test orders.
 *
 * Run:  npx tsx scripts/seed-orders.ts
 *
 * What it does:
 *   1. Connects to SFTP
 *   2. Uploads a GORDP XML file for each order to dg2partner
 *   3. The Sellon platform picks them up and creates the orders
 *
 * Orders seeded:
 *   61830301 — BT-SPK-001 (backordered)
 *   61830302 — BT-SPK-002, AKK-LDG-001, BB-FLA-002
 *   61830303 — BB-FLA-004 (unknown SKU), DART-S-004, BACK-001
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getSftpHelper } from '../helpers/sftp-upload';
import { buildGORDP } from '../helpers/edi-builder';

// ─── Delivery address used for all 3 test orders ──────────────────────────────
const deliveryAddress = {
  name:    'Test Buyer',
  street:  'Bahnhofstrasse 1',
  city:    'Zurich',
  zip:     '8001',
  country: 'CH',
};

// ─── Order definitions ────────────────────────────────────────────────────────
const ORDERS = [
  {
    id: '61830301',
    positions: [
      { sku: 'BT-SPK-001', qty: 2, price: 49.90 },
    ],
  },
  {
    id: '61830302',
    positions: [
      { sku: 'BT-SPK-002', qty: 10, price: 59.90 },
      { sku: 'AKK-LDG-001', qty: 3,  price: 19.90 },
      { sku: 'BB-FLA-002',  qty: 5,  price: 29.90 },
    ],
  },
  {
    id: '61830303',
    positions: [
      { sku: 'BB-FLA-004',  qty: 1,  price: 34.90 },  // unknown SKU — triggers unknown status
      { sku: 'DART-S-004',  qty: 2,  price: 24.90 },
      { sku: 'BACK-001',    qty: 1,  price: 14.90 },
    ],
  },
];

// ─── Upload directory — platform reads GORDP from here ───────────────────────
const UPLOAD_DIR = process.env.SFTP_REMOTE_OUT_DIR || '/uploads/stage/OrderData/Test/dg2partner';

async function main() {
  const sftp = getSftpHelper();

  if (!sftp.isConfigured) {
    console.error('ERROR: SFTP_HOST is not set. Check your .env file.');
    process.exit(1);
  }

  console.log('Connecting to SFTP...');
  await sftp.connect();
  console.log('Connected.\n');

  let allOk = true;

  for (const order of ORDERS) {
    const edi = buildGORDP(order.id, order.positions, deliveryAddress);

    // Override filename to use the order ID exactly as the platform expects
    const filename = `GORDP_${process.env.SFTP_SUPPLIER_ID || '223344'}_${order.id}_${Date.now()}.xml`;

    // Upload to dg2partner (platform reads GORDP from here)
    const remotePath = `${UPLOAD_DIR}/${filename}`;
    try {
      const buf = Buffer.from(edi.content, 'utf-8');
      // Use internal sftp client via uploadEDIContent with custom dir
      const result = await (sftp as any).sftp.put(buf, remotePath);
      console.log(`✓  Order ${order.id} → ${filename}`);
      console.log(`   Positions: ${order.positions.map(p => p.sku).join(', ')}`);
    } catch (e) {
      console.error(`✗  Order ${order.id} FAILED:`, (e as Error).message);
      allOk = false;
    }
  }

  await sftp.disconnect();
  console.log('\nDone.');

  if (!allOk) {
    console.error('\nSome uploads failed — check SFTP directory path and credentials.');
    process.exit(1);
  }

  console.log('\nNext steps:');
  console.log('  1. Wait ~30-60 seconds for the platform to process the GORDP files');
  console.log('  2. Log in to stage.sellon.ch and check Orders — you should see 61830301, 61830302, 61830303');
  console.log('  3. Re-run the order-workflow tests: npx playwright test tests/order-workflow-pom.spec.ts');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
