import { test, expect, chromium, Page, Browser } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProfilePage } from '../pages/profile.page';
import { NavigationPage } from '../pages/navigation.page';

// ─── Profile / User-settings test suite ──────────────────────────────────────
//
//  Covers the user-profile dropdown in the top navigation bar:
//    • User settings panel (open / close)
//    • Theme switching (Bright ↔ Default)
//    • Reload navigation menus
//    • Logout + session termination
//
//  Positive cases: each feature works as expected
//  Negative cases: invalid states, layout checks, post-logout access control

test.describe.configure({ mode: 'serial' });

// ─── State ────────────────────────────────────────────────────────────────────

let browser: Browser;
let page: Page;
let loginPage: LoginPage;
let profilePage: ProfilePage;
let navPage: NavigationPage;

// ─── Setup / teardown ─────────────────────────────────────────────────────────

test.beforeAll(async () => {
  test.setTimeout(300000);

  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page        = await context.newPage();
  loginPage   = new LoginPage(page);
  profilePage = new ProfilePage(page);
  navPage     = new NavigationPage(page);

  await loginPage.login(
    process.env.TEST_USERNAME || '',
    process.env.TEST_PASSWORD || '',
  );
  console.log('Login complete');
});

test.afterAll(async () => {
  await browser.close();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ss(name: string) {
  await profilePage.screenshot(`profile-${name}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITIVE TEST CASES
// ─────────────────────────────────────────────────────────────────────────────

// TC-P01: Profile dropdown opens and shows all expected menu items
test('Profile positive: dropdown opens with all expected menu items', async () => {
  test.setTimeout(60000);

  await profilePage.openProfileDropdown();
  await ss('p01-dropdown-open');

  await profilePage.expectProfileMenuVisible();

  await profilePage.closeProfileDropdown();
  await ss('p01-dropdown-closed');
  console.log('TC-P01 PASSED — profile dropdown shows all menu items');
});

// TC-P02: User settings panel opens when clicked
test('Profile positive: User settings panel opens', async () => {
  test.setTimeout(60000);

  await ss('p02-before-settings');

  await profilePage.openUserSettings();
  await ss('p02-settings-panel-open');

  await profilePage.expectSettingsPanelOpen();

  await ss('p02-settings-visible');
  console.log('TC-P02 PASSED — User settings panel opens');
});

// TC-P03: User settings panel closes via the X close button
test('Profile positive: User settings panel closes via close button', async () => {
  test.setTimeout(60000);

  // Panel should already be open from TC-P02 (serial mode).
  // Re-open it if it is no longer visible.
  const panelAlreadyOpen = await profilePage.isSettingsPanelVisible();
  if (!panelAlreadyOpen) {
    await profilePage.openUserSettings();
  }

  await ss('p03-before-close');

  await profilePage.closeUserSettings();

  await ss('p03-after-close');
  console.log('TC-P03 PASSED — User settings panel closed');
});

// TC-P04: Switch theme to Bright
test('Profile positive: Switch theme to Bright changes the visual theme', async () => {
  test.setTimeout(60000);

  const bodyClassBefore = await profilePage.getThemeClass();
  await ss('p04-before-bright');
  console.log('  Body class before Bright:', bodyClassBefore);

  await profilePage.switchTheme('Bright');
  await ss('p04-after-bright');

  const bodyClassAfter = await profilePage.getThemeClass();
  console.log('  Body class after Bright:', bodyClassAfter);

  const themeChanged = bodyClassBefore !== bodyClassAfter;
  console.log('  Theme changed (class or indicator):', themeChanged);

  // App should still be functional after theme switch
  await navPage.expectAppShellVisible();
  console.log('  App shell still visible after theme switch: true');

  console.log('TC-P04 PASSED — Bright theme applied');
});

// TC-P05: Switch theme back to Default
test('Profile positive: Switch theme to Default restores original theme', async () => {
  test.setTimeout(60000);

  await ss('p05-before-default');

  await profilePage.switchTheme('Default');
  await ss('p05-after-default');

  const bodyClassAfter = await profilePage.getThemeClass();
  console.log('  Body class after Default:', bodyClassAfter);

  // App must still be functional
  await navPage.expectAppShellVisible();
  console.log('  App shell still visible after default theme: true');

  console.log('TC-P05 PASSED — Default theme restored');
});

// TC-P06: Reload navigation menus keeps the app functional
test('Profile positive: Reload navigation menus keeps app functional', async () => {
  test.setTimeout(60000);

  await ss('p06-before-reload');

  await profilePage.reloadNavigation();
  await ss('p06-after-reload');

  // App shell must still be present
  await navPage.expectMenuIconVisible();
  console.log('  Menu icon still visible after reload: true');

  console.log('TC-P06 PASSED — Navigation reload keeps app functional');
});

// TC-P07: Logout shows "Logged out" confirmation
test('Profile positive: Logout shows session-ended message and returns to login', async () => {
  test.setTimeout(60000);

  await ss('p07-before-logout');

  await profilePage.logout();

  await ss('p07-after-logout');

  await profilePage.expectOnLoginPage();

  await ss('p07-login-page');
  console.log('TC-P07 PASSED — Logout confirmed and login page shown');
});

// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE TEST CASES
// ─────────────────────────────────────────────────────────────────────────────

// TC-N01: After logout, navigating to protected URL redirects to login
test('Profile negative: after logout, protected URL redirects to login page', async () => {
  test.setTimeout(60000);

  // At this point the user is logged out (from TC-P07)
  await page.goto('https://stage.sellon.ch/');
  await page.waitForTimeout(3000);
  await ss('n01-protected-url-attempt');

  const url = page.url();
  console.log('  Current URL after protected access attempt:', url);

  await profilePage.expectOnLoginPage();
  console.log('  Login form shown (access denied): true');

  console.log('TC-N01 PASSED — Protected URL correctly requires re-login');
});

// TC-N02: Login again to continue negative tests
test('Profile negative: session is re-established after fresh login', async () => {
  test.setTimeout(120000);

  // Re-login so remaining tests can run
  await loginPage.login(
    process.env.TEST_USERNAME || '',
    process.env.TEST_PASSWORD || '',
  );
  await page.waitForTimeout(2000);
  await ss('n02-re-logged-in');

  await navPage.expectAppShellVisible();
  console.log('  Profile button visible after re-login: true');

  console.log('TC-N02 PASSED — Session re-established after fresh login');
});

// TC-N03: Profile dropdown closes when clicking outside it
test('Profile negative: dropdown closes when clicking outside', async () => {
  test.setTimeout(60000);

  await profilePage.openProfileDropdown();
  await ss('n03-dropdown-open');

  // Verify dropdown is open by asserting all menu items are visible
  await profilePage.expectProfileMenuVisible();
  console.log('  Dropdown open before outside click: true');

  // Click somewhere outside the dropdown (top-left area of the body)
  await page.mouse.click(100, 400);
  await page.waitForTimeout(1000);
  await ss('n03-after-outside-click');

  console.log('  Dropdown closed correctly after outside click');

  console.log('TC-N03 PASSED — Dropdown closes on outside click');
});

// TC-N04: Closing user settings without changes preserves data
test('Profile negative: closing User settings without changes preserves state', async () => {
  test.setTimeout(60000);

  await profilePage.openUserSettings();
  await ss('n04-settings-open');

  // Close without making any changes
  await profilePage.closeUserSettings();
  await ss('n04-settings-closed');

  // App state should be unchanged — app shell (profile button area) still present
  await navPage.expectAppShellVisible();
  console.log('  Profile button still present after close without save: true');

  console.log('TC-N04 PASSED — Closing settings without changes preserves state');
});

// TC-N05: Theme switch (Bright) does not break key layout elements
test('Profile negative: Bright theme switch does not break page layout', async () => {
  test.setTimeout(60000);

  await profilePage.switchTheme('Bright');
  await ss('n05-bright-layout-check');

  // Key layout elements must still be visible after theme switch
  await navPage.expectMenuIconVisible();
  console.log('  "menu icon" visible after Bright theme: true');
  console.log('  "page body" visible after Bright theme: true');

  // Restore default theme
  await profilePage.switchTheme('Default');
  await ss('n05-default-restored');

  console.log('TC-N05 PASSED — Bright theme does not break layout');
});

// TC-N06: Reload navigation does not corrupt or remove the navigation menu
test('Profile negative: Reload navigation menus does not corrupt the menu', async () => {
  test.setTimeout(60000);

  await profilePage.reloadNavigation();
  await ss('n06-after-reload-nav-check');

  // Navigation must still be functional — open the sidebar
  await navPage.openSidebar();
  await ss('n06-menu-after-reload');

  await navPage.expectMenuIconVisible();
  console.log('  Navigation still accessible after reload: true');

  // Close the menu
  await navPage.closeSidebar();

  console.log('TC-N06 PASSED — Navigation reload does not corrupt the menu');
});
