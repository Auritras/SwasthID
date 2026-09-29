// Accounts and sync against the Firebase emulators, with the real
// firestore.rules. Run with `npm run test:emulator`.
const { test, expect, prepareContext } = require('../e2e/fixtures');
const { createUser, idToken, readUserDoc, listEntries, logIn } = require('./helpers');

test.use({ signedIn: false });

test('won\'t sign in until the email address is verified', async ({ page }) => {
  const user = await createUser('unverified', { verified: false });
  await page.goto('/');
  await page.fill('#healthId', user.email);
  await page.fill('#password', user.password);
  await page.click('.login-btn');
  await expect(page.locator('#medToast')).toContainText('verify your email');
  await expect(page.locator('#loginScreen')).toBeVisible();
  await expect(page.locator('#dashboard')).toBeHidden();
});

test('a reading saved on one device appears on another', async ({ page, browser, errors }) => {
  const user = await createUser('sync');
  await logIn(page, user);
  await page.evaluate(async () => { Object.assign(patientData, { name: 'Sync Test', profileCompleted: true }); await syncProfileToCloud(); window.closeProfileModal?.(); });
  await page.evaluate(() => showTab('vitals'));
  await page.fill('#vSys', '126');
  await page.fill('#vDia', '81');
  await page.click('#vitalsForm [type="submit"]');
  await expect(page.locator('#vitalsLatest')).toContainText('126/81');
  // Wait until the reading is actually stored in the account.
  await expect.poll(async () => JSON.stringify(await listEntries(user.uid)), { timeout: 15_000 }).toContain('126');

  const other = await browser.newContext();
  await prepareContext(other);
  const phone = await other.newPage();
  await logIn(phone, user);
  await phone.evaluate(() => { window.closeProfileModal?.(); showTab('vitals'); });
  await expect(phone.locator('#vitalsLatest')).toContainText('126/81');
  await expect(phone.locator('#dashboardGreetingName')).toHaveText('Sync');
  await other.close();
  expect(errors).toEqual([]);
});

test('another account can\'t read my record', async ({ page }) => {
  const me = await createUser('owner');
  const someoneElse = await createUser('intruder');
  await logIn(page, me);
  await page.evaluate(async () => { Object.assign(patientData, { name: 'Private Person', profileCompleted: true }); await syncProfileToCloud(); });

  expect((await readUserDoc(me.uid, await idToken(me))).status).toBe(200);
  expect((await readUserDoc(me.uid, await idToken(someoneElse))).status).toBe(403);
});

test('deleting the account removes the sign-in and the data', async ({ page }) => {
  const user = await createUser('delete');
  await logIn(page, user);
  await page.evaluate(async () => { Object.assign(patientData, { name: 'Delete Me', profileCompleted: true }); await syncProfileToCloud(); window.closeProfileModal?.(); });
  expect((await readUserDoc(user.uid)).status).toBe(200);

  page.on('dialog', d => d.accept());
  await page.evaluate(() => showTab('profile'));
  await page.click('#deleteAccountBtn');
  await expect(page.locator('#loginScreen')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await readUserDoc(user.uid)).status).toBe(404);
  expect(await idToken(user)).toBeNull();
  // Nothing personal is left on the device. (The daily counters are written
  // again by the midnight-reset timer and hold only today's date and 0 kcal.)
  const left = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('swasth_')).map(k => [k, localStorage.getItem(k)])));
  const { swasth_lastActiveDate, swasth_addedKcal, ...personal } = left;
  expect(personal).toEqual({});
  expect([undefined, '0']).toContain(swasth_addedKcal);
});
