// Accounts and sync against the Firebase emulators, with the real
// firestore.rules. Run with `npm run test:emulator`.
const { test, expect, prepareContext } = require('../e2e/fixtures');
const { createUser, verifyByEmail, idToken, readUserDoc, listEntries, logIn } = require('./helpers');

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

test('the name given at sign-up is the one the app greets you by', async ({ page, errors }) => {
  const email = `named-${Date.now()}@example.com`;
  await page.goto('/');
  await page.click('#createAccountBtn');
  await page.fill('#signupFirstName', 'Meera');
  await page.fill('#healthId', email);
  await page.fill('#password', 'secret123');
  await page.fill('#confirmPassword', 'secret123');
  await page.click('.login-btn');
  await expect.poll(async () => (await verifyByEmail(email))?.displayName, { timeout: 15_000 }).toBe('Meera');
  await page.reload();
  await logIn(page, { email, password: 'secret123' });
  await expect(page.locator('#dashboardGreetingName')).toHaveText('Meera');
  await expect(page.locator('#profileFirstNameInput')).toHaveValue('Meera');
  expect(errors).toEqual([]);
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

test('what is left in a pack is the same on every device', async ({ page, browser }) => {
  const user = await createUser('refill');
  await logIn(page, user);
  await page.evaluate(async () => {
    Object.assign(patientData, { name: 'Refill Test', profileCompleted: true, medications: [{ name: 'Paracetamol', dose: '1 tablet', schedule: 'Twice daily', times: ['08:00', '20:00'], packSize: '30' }] });
    localStorage.setItem('swasth_profile_medications', JSON.stringify(patientData.medications));
    await syncProfileToCloud();
    window.closeProfileModal?.();
    renderPersonalizedUI();
  });
  const refill = p => p.locator('.refill-item', { hasText: 'Paracetamol' });
  await expect(refill(page)).toContainText('30 of 30 left');
  await page.locator('.today-med-item', { hasText: 'Paracetamol' }).first().locator('.med-action').click();
  await expect(refill(page)).toContainText('29 of 30 left');
  // Wait until the taken dose is stored in the account.
  await expect.poll(async () => JSON.stringify(await listEntries(user.uid)), { timeout: 15_000 }).toContain('Paracetamol');

  const other = await browser.newContext();
  await prepareContext(other);
  const phone = await other.newPage();
  await logIn(phone, user);
  await phone.evaluate(() => { window.closeProfileModal?.(); renderPersonalizedUI(); });
  await expect(refill(phone)).toContainText('29 of 30 left');
  await other.close();
});

test('a record restored from a Health Vault file is saved to the account', async ({ page, browser }) => {
  const user = await createUser('restore');
  await logIn(page, user);
  await page.evaluate(() => { window.closeProfileModal?.(); showTab('share'); });
  const file = {
    resourceType: 'Bundle', type: 'collection', generatedAt: '2026-09-01T10:00:00.000Z', meta: { profile: 'SwasthID Health Summary' },
    vitalsLog: [{ id: 'v1', type: 'bp', sys: 131, dia: 84, at: '2026-09-01T08:00:00.000Z' }],
    doseHistory: [], foodLog: [], refills: {},
    family: [{ id: 'd1', name: 'Asha Sen', relation: 'Mother', ownerUid: 'someone-else' }],
    swasthid: { version: 1, profile: { name: 'Restored Person', bloodGroup: 'A+', profileCompleted: true, ownerUid: 'someone-else' } },
  };
  await page.setInputFiles('#restoreHealthJsonInput', { name: 'vault.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await page.getByRole('button', { name: 'Replace my record' }).click();
  await expect(page.locator('#healthShareStatus')).toHaveText('Record restored from the file.');
  await expect.poll(async () => JSON.stringify(await listEntries(user.uid)), { timeout: 15_000 }).toContain('131');

  const other = await browser.newContext();
  await prepareContext(other);
  const phone = await other.newPage();
  await logIn(phone, user);
  await phone.evaluate(() => { window.closeProfileModal?.(); showTab('vitals'); });
  await expect(phone.locator('#vitalsLatest')).toContainText('131/84');
  await expect(phone.locator('#dashboardGreetingName')).toHaveText('Restored');
  // Family members from the file belong to this account now.
  expect(await phone.evaluate(() => getDependents().map(d => d.name))).toEqual(['Asha Sen']);
  expect(await phone.evaluate(() => [patientData.ownerUid === firebaseUser.uid, patientData.bloodGroup])).toEqual([true, 'A+']);
  await other.close();
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
