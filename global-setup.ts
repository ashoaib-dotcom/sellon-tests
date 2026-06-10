import { chromium } from '@playwright/test';

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
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await page.waitForTimeout(3000);

    // Screenshot of login page
    await page.screenshot({ path: 'login-page.png', fullPage: true });
    console.log('📸 Login page screenshot saved');
    console.log('Page title:', await page.title());
    console.log('Page URL:', page.url());

    // Log all inputs found on page
    const allInputs = page.locator('input');
    const inputCount = await allInputs.count();
    console.log(`Found ${inputCount} input fields`);

    for (let i = 0; i < inputCount; i++) {
      const input = allInputs.nth(i);
      const type = await input.getAttribute('type');
      const name = await input.getAttribute('name');
      const id = await input.getAttribute('id');
      const placeholder = await input.getAttribute('placeholder');
      console.log(`  Input[${i}]: type="${type}" name="${name}" id="${id}" placeholder="${placeholder}"`);
    }

    // Log all buttons found on page
    const allButtons = page.locator('button');
    const btnCount = await allButtons.count();
    console.log(`Found ${btnCount} buttons`);

    for (let i = 0; i < btnCount; i++) {
      const btn = allButtons.nth(i);
      const text = await btn.innerText().catch(() => '');
      const type = await btn.getAttribute('type');
      console.log(`  Button[${i}]: type="${type}" text="${text}"`);
    }

    // Fill username
    console.log('📝 Filling username...');
    try {
      await page.locator('input[type="text"]').first().fill(
        process.env.TEST_USERNAME || '', { timeout: 5000 }
      );
      console.log('✅ Username filled via input[type="text"]');
    } catch {
      try {
        await page.locator('input[name="username"]').fill(
          process.env.TEST_USERNAME || '', { timeout: 5000 }
        );
        console.log('✅ Username filled via input[name="username"]');
      } catch {
        await page.locator('input').first().fill(
          process.env.TEST_USERNAME || '', { timeout: 5000 }
        );
        console.log('✅ Username filled via first input');
      }
    }

    // Fill password
    console.log('📝 Filling password...');
    try {
      await page.locator('input[type="password"]').first().fill(
        process.env.TEST_PASSWORD || '', { timeout: 5000 }
      );
      console.log('✅ Password filled');
    } catch (e) {
      console.error('❌ Could not fill password:', e);
    }

    // Screenshot before clicking login
    await page.screenshot({ path: 'before-login.png', fullPage: true });
    console.log('📸 Before login screenshot saved');

    // Click login button
    console.log('🖱️ Clicking login button...');
    try {
      await page.locator('button[type="submit"]').click({ timeout: 5000 });
      console.log('✅ Clicked submit button');
    } catch {
      try {
        await page.locator('button').first().click({ timeout: 5000 });
        console.log('✅ Clicked first button');
      } catch (e) {
        console.error('❌ Could not click button:', e);
      }
    }

    // Wait for page transition
    console.log('⏳ Waiting for login to complete...');
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Handle session popup ("You have an active session — continue?")
    try {
      const sessionBtn = page.getByRole('button', { name: /^(Yes|Continue|OK)$/i }).first();
      await sessionBtn.waitFor({ state: 'visible', timeout: 8000 });
      await sessionBtn.click();
      console.log('✅ Session popup handled — clicked continue');
      await page.waitForTimeout(3000);
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    } catch {
      console.log('No session popup found');
    }

    // If redirected back to login after session popup, log in again
    try {
      const isLoginAgain = await page.locator('input[type="password"]').isVisible({ timeout: 5000 });
      if (isLoginAgain) {
        console.log('📝 Back on login page — logging in again...');
        await page.locator('input[type="text"]').first().fill(process.env.TEST_USERNAME || '');
        await page.locator('input[type="password"]').first().fill(process.env.TEST_PASSWORD || '');
        await page.locator('button[type="submit"]').click({ timeout: 5000 }).catch(() =>
          page.locator('button').first().click({ timeout: 5000 })
        );
        await page.waitForTimeout(5000);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      }
    } catch {
      console.log('Not on login page — login succeeded');
    }

    // Screenshot after login
    await page.screenshot({ path: 'after-login.png', fullPage: true });
    console.log('📸 After login screenshot saved');
    console.log('URL after login:', page.url());
    console.log('Title after login:', await page.title());

    // Wait for app shell to confirm login success before saving state
    console.log('⏳ Waiting for dashboard app shell...');
    await page.locator('.menu-icon').waitFor({ state: 'visible', timeout: 60000 });
    console.log('✅ Dashboard loaded — login confirmed');

    // Save auth state
    console.log('💾 Saving auth-state.json...');
    await context.storageState({ path: 'auth-state.json' });
    console.log('✅ auth-state.json saved successfully!');

  } catch (error) {
    console.error('❌ Global setup error:', error);
    await page.screenshot({ path: 'error-screenshot.png', fullPage: true }).catch(() => {});
    // Do NOT save an unauthenticated state — tests will fall back to manual login
    throw error;
  } finally {
    await browser.close();
    console.log('🏁 Browser closed');
  }
}

export default globalSetup;