const { test, expect, openApp } = require('./fixtures');

const SCREENS = {
  home: 'Home', records: 'Records', timeline: 'Records', share: 'Records', scan: 'Medicines', order: 'Medicines',
  vitals: 'Health', nutrition: 'Health', predict: 'Health', emergency: 'Care', doctor: 'Care', profile: 'Account', register: 'Account',
};

test('loads every script and opens every screen without errors', async ({ page, errors }) => {
  await openApp(page);
  const scripts = await page.evaluate(() => [...document.scripts].filter(s => s.src.includes('/assets/js/')).length);
  expect(scripts).toBeGreaterThanOrEqual(24);
  for (const [tab, group] of Object.entries(SCREENS)) {
    await page.evaluate(t => showTab(t), tab);
    await expect(page.locator(`#panel-${tab}`)).toBeVisible();
    if (tab !== 'home') await expect(page.locator('#pageTitle')).toHaveText(group);
  }
  expect(errors).toEqual([]);
});

test.describe('signed out', () => {
  test.use({ signedIn: false });

  test('shows the log-in page, and switches to sign-up', async ({ page, errors }) => {
    await page.goto('/');
    await expect(page.locator('#loginTitle')).toHaveText('Welcome back');
    await expect(page.locator('#confirmPasswordField')).toBeHidden();
    await page.click('#createAccountBtn');
    await expect(page.locator('#confirmPasswordField')).toBeVisible();
    await expect(page.locator('.login-btn')).toHaveText('Create account');
    await page.fill('#password', 'secret123');
    await page.click('#togglePwBtn');
    await expect(page.locator('#password')).toHaveAttribute('type', 'text');
    expect(errors).toEqual([]);
  });

  test('asks for an email before logging in', async ({ page }) => {
    await page.goto('/');
    await page.click('.login-btn');
    await expect(page.locator('#idError')).toBeVisible();
  });
});

test('dark mode stays on after a reload', async ({ page }) => {
  await openApp(page);
  await page.click('#darkModeToggle');
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
});
