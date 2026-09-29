const { test, expect, openApp } = require('./fixtures');

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => showTab('vitals'));
});

test('saves a blood pressure reading and flags it against the reference range', async ({ page, errors }) => {
  await page.fill('#vSys', '132');
  await page.fill('#vDia', '84');
  await page.click('#vitalsForm [type="submit"]');
  const tile = page.locator('#vitalsLatest .vital-tile').first();
  await expect(tile).toContainText('132/84');
  await expect(tile).toContainText('High (stage 1)');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('swasth_vitals')));
  expect(saved).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('rejects a diastolic value higher than the systolic', async ({ page }) => {
  await page.fill('#vSys', '80');
  await page.fill('#vDia', '120');
  await page.click('#vitalsForm [type="submit"]');
  await expect(page.locator('#vitalsFormError')).toContainText('Systolic');
  expect(await page.evaluate(() => localStorage.getItem('swasth_vitals'))).toBeNull();
});
