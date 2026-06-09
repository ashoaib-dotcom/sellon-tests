import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/old/**'],  // ← ADD THIS LINE
  timeout: 300000,
  expect: {
    timeout: 30000,
  },
  use: {
    baseURL: process.env.BASE_URL || 'https://your-app-url.com',
    headless: true,
    channel: 'chrome',
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    navigationTimeout: 120000,
    actionTimeout: 30000,
    launchOptions: {
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    },
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { channel: 'chrome' },
    },
  ],
  reporter: [['html'], ['list']],
});