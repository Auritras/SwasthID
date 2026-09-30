// Browser tests. `npm run test:e2e` runs tests/e2e against a server in demo
// mode (no Firebase). `npm run test:emulator` starts the Firebase emulators
// and also runs tests/emulator against a second server that uses them.
const { defineConfig } = require('@playwright/test');

const APP_PORT = 10100;
const EMU_PORT = 10101;
const CI = !!process.env.CI;
// Set by `firebase emulators:exec` (see the test:emulator script).
const EMULATORS = !!(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
const SERVER_ENV = { EMERGENCY_SECRET: 'test-only-emergency-secret-0123456789abcdef', ALLOWED_ORIGIN: '*' };

module.exports = defineConfig({
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    viewport: { width: 1280, height: 900 },
    // Service workers answer requests before Playwright can intercept them,
    // so they are off except in the offline test.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    // Full Chromium in headless mode: the lighter headless shell always
    // reports notification permission as denied, even when granted.
    channel: 'chromium',
    // Point at a local Chromium when the Playwright download isn't available.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'app', testDir: './tests/e2e', use: { baseURL: `http://127.0.0.1:${APP_PORT}` } },
    ...(EMULATORS ? [{ name: 'emulator', testDir: './tests/emulator', fullyParallel: false, use: { baseURL: `http://127.0.0.1:${EMU_PORT}` } }] : []),
  ],
  webServer: [
    {
      command: 'node server.js',
      url: `http://127.0.0.1:${APP_PORT}/health`,
      env: { ...SERVER_ENV, PORT: String(APP_PORT), DEMO_MODE: '1' },
      reuseExistingServer: !CI,
    },
    ...(EMULATORS ? [{
      command: 'node server.js',
      url: `http://127.0.0.1:${EMU_PORT}/health`,
      env: {
        ...SERVER_ENV, PORT: String(EMU_PORT), FIREBASE_PROJECT_ID: process.env.GCLOUD_PROJECT || 'demo-swasthid',
        // Account emails go to the catcher in tests/emulator/account-emails.spec.js.
        SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525', SMTP_USER: 'test', SMTP_PASS: 'test', MAIL_FROM: 'SwasthID <no-reply@example.com>',
        // Dose-reminder pushes go to the fake Worker in tests/emulator/push-reminders.spec.js.
        PUSH_WORKER_URL: 'http://127.0.0.1:2526', PUSH_WORKER_SECRET: 'test-only-push-secret-0123456789',
        VAPID_PUBLIC_KEY: 'BP4Pmss7ZxvwNXeT9cQFjneGq14iwnF0IcBZlZ46T8kk4s2lVbjQeu8mzRkLD1ANg3uOPST-zX7t0xeG-lOUBsE',
      },
      reuseExistingServer: !CI,
    }] : []),
  ],
});
