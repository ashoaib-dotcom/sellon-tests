import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log('🔐 Logging in globally...');

  await page.goto(process.env.BASE_URL || 'https://stage.sellon.ch/');

  await page.fill('input[type="text"]', process.env.TEST_USERNAME || '');
  await page.fill('input[type="password"]', process.env.TEST_PASSWORD || '');

  await page.click('button[type="submit"]');

  await page.waitForSelector('.menu-icon', { timeout: 60000 });

  console.log('✅ Login successful! Saving session...');

  await page.context().storageState({ path: 'auth-state.json' });

  await browser.close();
  console.log('✅ Global setup complete!');
}

export default globalSetup;