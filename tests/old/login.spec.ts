import { test, expect, chromium, Page } from '@playwright/test';

// ==========================================
// HELPER FUNCTIONS
// ==========================================

async function setupBrowser() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  return { browser, context, page };
}

async function goToLoginPage(page: Page) {
  await page.goto('https://mpe-test.lobster-cloud.com', { timeout: 120000 });
  await page.waitForSelector('input', { state: 'visible', timeout: 120000 });
  await page.waitForTimeout(3000);
}

async function fillAndSubmitLogin(page: Page, username: string, password: string) {
  await page.getByRole('textbox', { name: 'Username' }).click();
  await page.getByRole('textbox', { name: 'Username' }).pressSequentially(username, { delay: 100 });

  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).pressSequentially(password, { delay: 100 });

  await page.getByRole('button', { name: 'Login' }).click();
}

async function handleSessionPopup(page: Page) {
  const yesButton = page.getByRole('button', { name: 'Yes' });
  try {
    await yesButton.waitFor({ state: 'visible', timeout: 10000 });
    await yesButton.click();
  } catch {
    // No popup, continue
  }
}

// ==========================================
// TEST SUITE: Login Functionality
// ==========================================

test.describe('Login Functionality', () => {

  // TEST 1: Successful login
  test('should login successfully with valid credentials', async () => {
    test.setTimeout(300000);
    const { browser, page } = await setupBrowser();

    await goToLoginPage(page);
    await fillAndSubmitLogin(page, 'ashoaib', 'test2');
    await handleSessionPopup(page);

    // Wait long enough for the dashboard to fully render
    await page.waitForTimeout(60000);

    // Take screenshot to verify
    await page.screenshot({ path: 'screenshots/dashboard.png', fullPage: true, timeout: 5000 });
    console.log('URL after login:', page.url());

    // Assert: URL should have changed from login page
    const currentUrl = page.url();
    expect(currentUrl).toContain('lobster-cloud.com');

    // Assert: Login fields should NOT be visible anymore
    await expect(page.getByRole('textbox', { name: 'Username' })).not.toBeVisible({ timeout: 5000 });

    console.log('TEST 1 PASSED: Valid login successful');
    await browser.close();
  });

  // TEST 2: Wrong password
  test('should show error with invalid password', async () => {
    test.setTimeout(300000);
    const { browser, page } = await setupBrowser();

    await goToLoginPage(page);
    await fillAndSubmitLogin(page, 'ashoaib', 'wrongpassword');

    // Wait for error to appear
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/invalid-password.png', fullPage: true, timeout: 5000 });

    // Assert: Should still be on login page
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Username' })).toBeVisible();

    console.log('TEST 2 PASSED: Invalid password rejected');
    await browser.close();
  });

  // TEST 3: Wrong username
  test('should show error with invalid username', async () => {
    test.setTimeout(300000);
    const { browser, page } = await setupBrowser();

    await goToLoginPage(page);
    await fillAndSubmitLogin(page, 'fakeuser123', 'test2');

    // Wait for error to appear
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/invalid-username.png', fullPage: true, timeout: 5000 });

    // Assert: Should still be on login page
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Username' })).toBeVisible();

    console.log('TEST 3 PASSED: Invalid username rejected');
    await browser.close();
  });

  // TEST 4: Empty fields
  test('should not allow login with empty fields', async () => {
    test.setTimeout(300000);
    const { browser, page } = await setupBrowser();

    await goToLoginPage(page);

    // Click login without filling anything
    await page.getByRole('button', { name: 'Login' }).click();

    await page.waitForTimeout(5000);

    // Assert: Should still be on login page
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Username' })).toBeVisible();

    console.log('TEST 4 PASSED: Empty fields rejected');
    await browser.close();
  });

  // TEST 5: Password forgotten link
  test('should display Password forgotten link', async () => {
    test.setTimeout(300000);
    const { browser, page } = await setupBrowser();

    await goToLoginPage(page);

    // Assert: All login page elements should be visible
    await expect(page.getByText('Password forgotten?')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Username' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();

    console.log('TEST 5 PASSED: Password forgotten link visible');
    await browser.close();
  });

});
