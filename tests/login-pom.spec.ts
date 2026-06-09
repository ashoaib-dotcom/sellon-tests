import { test, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';

let browser: Browser;
let page: Page;
let loginPage: LoginPage;

async function setupBrowser() {
  browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  page = await context.newPage();
  loginPage = new LoginPage(page);
}

test('POM Login: valid credentials should reach dashboard', async () => {
  test.setTimeout(300000);
  await setupBrowser();

  await loginPage.login(process.env.TEST_USERNAME || 'ashoaib', process.env.TEST_PASSWORD || 'test2');
  await loginPage.expectLoginFieldsGone();

  console.log('POM LOGIN TEST PASSED');
  await browser.close();
});

test('POM Login: invalid password should stay on login page', async () => {
  test.setTimeout(120000);
  await setupBrowser();

  await loginPage.goto();
  await loginPage.fillUsername('ashoaib');
  await loginPage.fillPassword('wrongpassword');
  await loginPage.clickLogin();
  await page.waitForTimeout(10000);

  await loginPage.expectLoginFieldsVisible();

  console.log('POM INVALID PASSWORD TEST PASSED');
  await browser.close();
});

test('POM Login: empty fields should stay on login page', async () => {
  test.setTimeout(120000);
  await setupBrowser();

  await loginPage.goto();
  await loginPage.clickLogin();
  await page.waitForTimeout(5000);

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
  await loginPage.fillUsername("' OR '1'='1");
  await loginPage.fillPassword("' OR '1'='1");
  await loginPage.clickLogin();
  await page.waitForTimeout(5000);

  await loginPage.expectLoginFieldsVisible();
  console.log('POM SQL INJECTION TEST PASSED');
  await browser.close();
});

test('POM Login: whitespace-only credentials should stay on login page', async () => {
  test.setTimeout(120000);
  await setupBrowser();

  await loginPage.goto();
  await loginPage.fillUsername('   ');
  await loginPage.fillPassword('   ');
  await loginPage.clickLogin();
  await page.waitForTimeout(5000);

  await loginPage.expectLoginFieldsVisible();
  console.log('POM WHITESPACE CREDENTIALS TEST PASSED');
  await browser.close();
});

test('POM Login: valid username with wrong case password should stay on login page', async () => {
  test.setTimeout(120000);
  await setupBrowser();

  await loginPage.goto();
  await loginPage.fillUsername('ashoaib');
  await loginPage.fillPassword('TEST2');
  await loginPage.clickLogin();
  await page.waitForTimeout(10000);

  await loginPage.expectLoginFieldsVisible();
  console.log('POM CASE SENSITIVE PASSWORD TEST PASSED');
  await browser.close();
});
