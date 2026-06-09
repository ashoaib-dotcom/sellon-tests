import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('🔐 Navigating to login page...');
  await page.goto(process.env.BASE_URL || 'https://stage.sellon.ch/');
  
  // Wait for page to load
  await page.waitForLoadState('networkidle', { timeout: 30000 });
  
  console.log('📸 Taking screenshot of login page...');
  await page.screenshot({ path: 'login-page.png' });

  console.log('🔐 Filling login credentials...');

  // Try multiple possible selectors for username
  const usernameSelectors = [
    'input[type="text"]',
    'input[name="username"]',
    'input[name="email"]',
    'input[id="username"]',
    'input[placeholder*="user" i]',
    'input[placeholder*="email" i]',
  ];

  for (const selector of usernameSelectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
      await el.fill(process.env.TEST_USERNAME || '');
      console.log(`✅ Username filled using: ${selector}`);
      break;
    }
  }

  // Try multiple possible selectors for password
  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[id="password"]',
  ];

  for (const selector of passwordSelectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
      await el.fill(process.env.TEST_PASSWORD || '');
      console.log(`✅ Password filled using: ${selector}`);
      break;
    }
  }

  // Try multiple possible selectors for login button
  const buttonSelectors = [
    'button[type="submit"]',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
    'input[type="submit"]',
  ];

  for (const selector of buttonSelectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
      await el.click();
      console.log(`✅ Login button clicked using: ${selector}`);
      break;
    }
  }

  // Wait for navigation after login
  await page.waitForLoadState('networkidle', { timeout: 60000 });
  await page.waitForTimeout(3000);

  console.log('📸 Taking screenshot after login...');
  await page.screenshot({ path: 'after-login.png' });

  console.log('✅ Saving auth state...');
  await context.storageState({ path: 'auth-state.json' });

  await browser.close();
  console.log('✅ Global setup complete!');
}

export default globalSetup;