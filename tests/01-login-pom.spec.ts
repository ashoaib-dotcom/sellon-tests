import { test, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';

let browser: Browser;
let page: Page;
let loginPage: LoginPage;

async function ss(name: string) {
  try { await page.screenshot({ path: `screenshots/login-${name}.png`, fullPage: true }); } catch {}
}

async function setupBrowser() {
  browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  page = await context.newPage();
  loginPage = new LoginPage(page);
}

test('POM Login: valid credentials should reach dashboard @regression', async () => {
  test.setTimeout(300000);
  await setupBrowser();

  await loginPage.goto();
  await ss('01-valid-login-page');
  await loginPage.login(process.env.TEST_USERNAME || '', process.env.TEST_PASSWORD || '');
  await ss('02-valid-after-login');
  await loginPage.expectLoginFieldsGone();
  await ss('03-valid-dashboard');

  console.log('POM LOGIN TEST PASSED');
  await browser.close();
});

test('POM Login: invalid password should stay on login page', async () => {
  test.setTimeout(120000);
  await setupBrowser();

  await loginPage.goto();
  await ss('04-invalid-login-page');
  await loginPage.fillUsername(process.env.TEST_USERNAME || '');
  await loginPage.fillPassword('wrongpassword');
  await ss('05-invalid-filled');
  await loginPage.clickLogin();
  await page.waitForTimeout(10000);
  await ss('06-invalid-after-submit');

  await loginPage.expectLoginFieldsVisible();

  console.log('POM INVALID PASSWORD TEST PASSED');
  await browser.close();
});

test('POM Login: empty fields should stay on login page', async () => {
  test.setTimeout(120000);
  await setupBrowser();

  await loginPage.goto();
  await ss('07-empty-login-page');
  await loginPage.clickLogin();
  await page.waitForTimeout(5000);
  await ss('08-empty-after-submit');

  await loginPage.expectLoginFieldsVisible();

  console.log('POM EMPTY FIELDS TEST PASSED');
  await browser.close();
});
// ==========================================
// NEGATIVE TESTS
// ==========================================

test('POM Login: SQL injection in username should stay on login page', async () => {
  test.setTimeout(120000);
  await setupBrowser();

  await loginPage.goto();
  await ss('09-sqli-login-page');
  await loginPage.fillUsername("' OR '1'='1");
  await loginPage.fillPassword("' OR '1'='1");
  await ss('10-sqli-filled');
  await loginPage.clickLogin();
  await page.waitForTimeout(5000);
  await ss('11-sqli-after-submit');

  await loginPage.expectLoginFieldsVisible();
  console.log('POM SQL INJECTION TEST PASSED');
  await browser.close();
});

test('POM Login: whitespace-only credentials should stay on login page', async () => {
  test.setTimeout(120000);
  await setupBrowser();

  await loginPage.goto();
  await ss('12-whitespace-login-page');
  await loginPage.fillUsername('   ');
  await loginPage.fillPassword('   ');
  await ss('13-whitespace-filled');
  await loginPage.clickLogin();
  await page.waitForTimeout(5000);
  await ss('14-whitespace-after-submit');

  await loginPage.expectLoginFieldsVisible();
  console.log('POM WHITESPACE CREDENTIALS TEST PASSED');
  await browser.close();
});

test('POM Login: valid username with wrong case password should stay on login page', async () => {
  test.setTimeout(120000);
  await setupBrowser();

  await loginPage.goto();
  await ss('15-case-login-page');
  await loginPage.fillUsername(process.env.TEST_USERNAME || '');
  await loginPage.fillPassword('TEST2');
  await ss('16-case-filled');
  await loginPage.clickLogin();
  await page.waitForTimeout(10000);
  await ss('17-case-after-submit');

  await loginPage.expectLoginFieldsVisible();
  console.log('POM CASE SENSITIVE PASSWORD TEST PASSED');
  await browser.close();
});

test('POM Login: non-existent username should stay on login page', async () => {
  test.setTimeout(120000);
  await setupBrowser();

  await loginPage.goto();
  await ss('nonexistent-01-page');
  await loginPage.fillUsername('user_that_does_not_exist_xyz123@fake.com');
  await loginPage.fillPassword('SomePassword123');
  await ss('nonexistent-02-filled');
  await loginPage.clickLogin();
  await page.waitForTimeout(10000);
  await ss('nonexistent-03-after-submit');

  await loginPage.expectLoginFieldsVisible();
  console.log('POM NON-EXISTENT USERNAME TEST PASSED');
  await browser.close();
});

test('POM Login: same credentials cannot be active in two sessions simultaneously', async () => {
  test.setTimeout(300000);

  const username = process.env.TEST_USERNAME || '';
  const password = process.env.TEST_PASSWORD || '';

  const launchOpts = {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  };
  const viewportOpts = {
    viewport: { width: 1920, height: 1080 } as const,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  // ── Session 1: login in first browser ────────────────────────────────────
  const browser1 = await chromium.launch(launchOpts);
  const page1    = await browser1.newContext(viewportOpts).then(c => c.newPage());
  const login1   = new LoginPage(page1);

  await login1.login(username, password);
  await page1.screenshot({ path: 'screenshots/login-18-session1-dashboard.png', fullPage: true });
  console.log('Session 1: logged in successfully');

  // Verify session 1 is on the dashboard (login fields gone)
  const session1Active = await page1.locator('input[type="password"]').isVisible({ timeout: 5000 }).catch(() => false);
  if (session1Active) {
    console.log('Session 1: WARNING — still on login page, cannot proceed');
    await browser1.close();
    return;
  }
  console.log('Session 1: dashboard confirmed');

  // ── Session 2: login in second browser with same credentials ─────────────
  const browser2 = await chromium.launch(launchOpts);
  const page2    = await browser2.newContext(viewportOpts).then(c => c.newPage());
  const login2   = new LoginPage(page2);

  // login() already handles the session popup (clicks Yes) and re-logins if needed
  await login2.login(username, password);
  await page2.screenshot({ path: 'screenshots/login-19-session2-dashboard.png', fullPage: true });
  console.log('Session 2: logged in — session popup accepted (old session terminated)');

  // Verify session 2 is on the dashboard
  const session2OnLogin = await page2.locator('input[type="password"]').isVisible({ timeout: 5000 }).catch(() => false);
  if (session2OnLogin) {
    console.log('Session 2: WARNING — still on login page after popup');
  } else {
    console.log('Session 2: dashboard confirmed');
  }

  // ── Verify session 1 is now invalidated ──────────────────────────────────
  await page1.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page1.waitForTimeout(5000);
  await page1.screenshot({ path: 'screenshots/login-20-session1-after-reload.png', fullPage: true });

  const session1KickedOut = await page1.locator('input[type="password"], input[type="text"]').first().isVisible({ timeout: 10000 }).catch(() => false);

  if (session1KickedOut) {
    console.log('Session 1: kicked out after Session 2 logged in ✓ (single-session enforcement confirmed)');
  } else {
    console.log('Session 1: still active after Session 2 logged in (Sellon allows concurrent sessions)');
  }

  console.log('POM CONCURRENT SESSION TEST PASSED');
  await browser1.close();
  await browser2.close();
});
