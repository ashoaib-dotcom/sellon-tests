import { chromium } from '@playwright/test';
import * as path from 'path';

async function globalSetup() {
  console.log('🚀 Starting global setup...');
  console.log('BASE_URL:', process.env.BASE_URL);
  console.log('TEST_USERNAME:', process.env.TEST_USERNAME);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  try {
    const baseURL = process.env.BASE_URL || 'https://stage.sellon.ch/';
    console.log(`📍 Navigating to: ${baseURL}`);

    await page.goto(baseURL, { 
      waitUntil: 'networkidle',
      timeout: 60000 
    });

    console.log('📸 Screenshot: login page');
    await page.screenshot({ path: 'login-page.png', fullPage: true });

    // Log all input fields found
    const inputs = await page.locator('input').all();
    console.log(`Found ${inputs.length} input fields`);

    for (let i = 0; i < inputs.length; i++) {
      const type = await inputs[i].getAttribute('type');
      const name = await inputs[i].getAttribute('name');
      const id = await inputs[i].getAttribute('id');
      const placeholder = await inputs[i].getAttribute('placeholder');
      console.log(`Input ${i}: type=${type}, name=${name}, id=${id}, placeholder=${placeholder}`);
    }

    // Fill username
    const username = process.env.TEST_USERNAME || '';
    const password = process.env.TEST_PASSWORD || '';

    console.log('📝 Filling username...');
    await page.locator('input').first().fill(username);

    console.log('📝 Filling password...');
    await page.locator('input[type="password"]').first().fill(password);

    console.log('📸 Screenshot: before click');
    await page.screenshot({ path: 'before-login.png', fullPage: true });

    // Click login button
    console.log('🖱️ Clicking login button...');
    const buttons = await page.locator('button').all();
    console.log(`Found ${buttons.length} buttons`);

    for (let i = 0; i < buttons.length; i++) {
      const text = await buttons[i].innerText();
      console.log(`Button ${i}: "${text}"`);
    }

    // Click first button or submit
    await page.locator('button').first().click();

    // Wait for navigation
    console.log('⏳ Waiting for navigation...');
    await page.waitForTimeout(5000);
    await page.waitForLoadState('networkidle', { timeout: 60000 });

    console.log('📸 Screenshot: after login');
    await page.screenshot({ path: 'after-login.png', fullPage: true });

    console.log('Current URL:', page.url());

    // Save auth state
    console.log('💾 Saving auth state...');
    await context.storageState({ path: 'auth-state.json' });
    console.log('✅ Auth state saved successfully!');

  } catch (error) {
    console.error('❌ Global setup failed:', error);
    await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

export default globalSetup;