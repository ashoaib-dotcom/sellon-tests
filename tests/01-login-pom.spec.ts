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
