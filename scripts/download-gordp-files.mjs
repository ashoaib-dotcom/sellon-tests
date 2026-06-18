import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Client from 'ssh2-sftp-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const sftp = new Client();
const cfg = {
  host: process.env.SFTP_HOST,
  port: parseInt(process.env.SFTP_PORT || '22'),
  username: process.env.SFTP_USERNAME,
  password: process.env.SFTP_PASSWORD,
  readyTimeout: 30000,
};

const inDir = process.env.SFTP_REMOTE_IN_DIR;

(async () => {
  try {
    await sftp.connect(cfg);
    console.log('Connected\n');

    // Download our most recent test GORDP (large file, openTRANS format)
    // From the SFTP listing: GORDP_223344_94336468_20260617110324.xml (6964 bytes)
    const testGordp = `${inDir}/GORDP_223344_94336468_20260617110324.xml`;
    const testContent = await sftp.get(testGordp);
    console.log('=== Our latest test GORDP (94336468) ===');
    console.log(testContent.toString());

    // Also download the working GORDR for order 61830310/737 to see what product data it contains
    const workingGordr = `${inDir}/GORDR_223344_61830310_737_20260617093701.xml`;
    const gordrContent = await sftp.get(workingGordr);
    console.log('\n=== Working GORDR for order 61830310 (Sellon #737) ===');
    console.log(gordrContent.toString());

    // Also get the GDELR for order 61830310 to see product data
    const workingGdelr = `${inDir}/GDELR_223344_61830310_721_20260617085801.xml`;
    const gdelrContent = await sftp.get(workingGdelr);
    console.log('\n=== Working GDELR for order 61830310/721 ===');
    console.log(gdelrContent.toString().substring(0, 3000));

    // Look for any GORDP from 54321 supplier (which creates real orders) to see correct format
    const files = await sftp.list(inDir);
    const gordps54321 = files.filter(f => f.name.startsWith('GORDP_54321'));
    if (gordps54321.length > 0) {
      console.log('\n=== GORDP from supplier 54321 ===');
      const content = await sftp.get(`${inDir}/${gordps54321[0].name}`);
      console.log(content.toString().substring(0, 3000));
    }

    await sftp.end();
  } catch (e) {
    console.error('ERROR:', e.message);
    try { await sftp.end(); } catch {}
  }
})();
