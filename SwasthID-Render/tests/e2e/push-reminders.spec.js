// What the service worker shows when a dose-reminder push arrives. The push
// names at most the kind of reminder and the dose times; the medicines come
// from the schedule the app saved on the device. Pushes are delivered through
// Chrome DevTools, as a push service would (already decrypted).
//
// The test records the notifications the service worker asks for, rather
// than reading them back from the browser: headless Chrome now and then drops
// a notification that was shown successfully, which made the old check flaky.
const { test, expect, openApp } = require('./fixtures');

test.use({ serviceWorkers: 'allow' });

const pad = n => String(n).padStart(2, '0');

async function setUp(page, context, medications) {
  await context.grantPermissions(['notifications']);
  await page.addInitScript(() => localStorage.setItem('swasth_doseReminders', 'on'));
  await openApp(page, { medications });
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Wait for the app to save today's schedule for the service worker.
  await expect.poll(() => page.evaluate(async () => {
    const res = await (await caches.open('swasth-state')).match('/__swasth/doses.json');
    return res ? (await res.json()).doses.length : 0;
  })).toBeGreaterThan(0);

  const cdp = await context.newCDPSession(page);
  const registrations = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', e => registrations.push(...e.registrations));
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => registrations.find(r => !r.isDeleted)?.registrationId).toBeTruthy();
  const { registrationId } = registrations.find(r => !r.isDeleted);
  const origin = new URL(page.url()).origin;

  // Record every notification the service worker shows.
  const worker = context.serviceWorkers().find(w => w.url().endsWith('/sw.js')) || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    self.__shown = [];
    const reg = self.registration;
    const show = reg.showNotification.bind(reg);
    reg.showNotification = (title, options = {}) => {
      self.__shown.push({ title, body: options.body, tag: options.tag, badge: new URL(options.badge, self.location.origin).pathname, actions: (options.actions || []).map(a => a.title), data: options.data });
      return show(title, options);
    };
  });
  return {
    worker,
    push: (message = '') => cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: message && JSON.stringify(message) }),
    shown: () => worker.evaluate(() => self.__shown.map(({ title, body, tag }) => ({ title, body, tag }))),
    last: () => worker.evaluate(() => self.__shown[self.__shown.length - 1]),
    badges: () => worker.evaluate(() => self.__shown.map(n => n.badge)),
    clear: () => worker.evaluate(async () => { self.__shown = []; (await self.registration.getNotifications()).forEach(n => n.close()); }),
  };
}

test('a push shows the medicines due now, and nothing once they are taken', async ({ page, context }) => {
  const now = new Date();
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const later = `${pad((now.getHours() + 6) % 24)}:${pad(now.getMinutes())}`;
  const sw = await setUp(page, context, [
    { name: 'Metformin', dose: '500 mg', schedule: 'Once daily', times: [time] },
    { name: 'Amlodipine', dose: '5 mg', schedule: 'Once daily', times: [time] },
    { name: 'Atorvastatin', dose: '10 mg', schedule: 'Once daily', times: [later] },
    { name: 'Methotrexate', dose: '7.5 mg', schedule: 'Once daily', times: [time], days: [(now.getDay() + 3) % 7] },
  ]);

  // Only names on the device: the saved copy is for the service worker alone.
  await sw.push();
  await expect.poll(sw.shown).toEqual([{ title: 'Time for 2 medicines', body: 'Metformin 500 mg, Amlodipine 5 mg. Tap Taken once you have had them.', tag: `swasth-dose-${time}` }]);
  // Without the reminder service (not set up on this test server) Snooze can't work, so only Taken is offered.
  expect((await sw.last()).actions).toEqual(['Taken']);
  // Android draws the small badge as a one-colour silhouette, so it must be a
  // transparent shape (not the square app icon, which shows as a white block).
  expect(await sw.badges()).toEqual(['/assets/badge-96.png']);
  expect((await page.request.get('/assets/badge-96.png')).status()).toBe(200);
  await sw.clear();

  // Mark Amlodipine taken: the next push names only Metformin.
  await page.evaluate(() => {
    const status = JSON.parse(localStorage.getItem('swasth_medStatus') || '{}');
    status[medicationScheduleKey(1, 0)] = { taken: true, date: new Date().toISOString() };
    localStorage.setItem('swasth_medStatus', JSON.stringify(status));
    window.refreshDoseReminders();
  });
  await expect.poll(() => page.evaluate(async () => (await (await (await caches.open('swasth-state')).match('/__swasth/doses.json')).json()).doses.filter(d => d.takenOn).length)).toBe(1);
  await sw.push();
  await expect.poll(sw.shown).toEqual([{ title: 'Time for Metformin 500 mg', body: 'Tap Taken once you have had it.', tag: `swasth-dose-${time}` }]);
  await sw.clear();

  // Both taken: the push is quiet.
  await page.evaluate(() => {
    const status = JSON.parse(localStorage.getItem('swasth_medStatus') || '{}');
    status[medicationScheduleKey(0, 0)] = { taken: true, date: new Date().toISOString() };
    localStorage.setItem('swasth_medStatus', JSON.stringify(status));
    window.refreshDoseReminders();
  });
  await expect.poll(() => page.evaluate(async () => (await (await (await caches.open('swasth-state')).match('/__swasth/doses.json')).json()).doses.filter(d => d.takenOn).length)).toBe(2);
  await sw.push();
  await page.waitForTimeout(1000);
  expect(await sw.shown()).toEqual([]);
});

test('a push with nothing on the schedule still reminds, and a test push says so', async ({ page, context }) => {
  const now = new Date();
  const sw = await setUp(page, context, [
    { name: 'Metformin', dose: '500 mg', schedule: 'Once daily', times: [`${pad((now.getHours() + 6) % 24)}:00`] },
  ]);
  await sw.push();
  await expect.poll(sw.shown).toEqual([{ title: 'Time for your medicines', body: 'Open SwasthID to see what is due and mark it taken.', tag: 'swasth-dose-due' }]);
  await sw.clear();

  await page.evaluate(async () => (await caches.open('swasth-state')).put('/__swasth/push-test', new Response(String(Date.now()))));
  await sw.push();
  await expect.poll(async () => (await sw.shown()).map(n => n.title)).toEqual(['Dose reminders are working']);
});

const nowTime = () => { const now = new Date(); return { time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, day: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` }; };

test('a nudge asks about doses not yet taken; Taken on it records them and counts down the pack', async ({ page, context, errors }) => {
  const { time, day } = nowTime();
  const sw = await setUp(page, context, [
    { name: 'Metformin', dose: '1 tablet', schedule: 'Once daily', times: [time], packSize: '8' },
    { name: 'Amlodipine', dose: '5 mg', schedule: 'Once daily', times: [time] },
  ]);
  const item = name => page.locator('.today-med-item', { hasText: name });
  await expect(page.locator('.refill-item', { hasText: 'Metformin' })).toContainText('8 of 8 left');

  // 30 minutes after the dose time, the reminder service asks again.
  await sw.push({ kind: 'nudge', day, times: [time] });
  await expect.poll(async () => (await sw.shown()).length).toBe(1);
  const nudge = await sw.last();
  expect(nudge.title).toMatch(/^Did you take your .+ medicines\?$/);
  expect(nudge.body).toMatch(/: Metformin 1 tablet, Amlodipine 5 mg\. Not marked taken yet\.$/);
  expect(nudge.tag).toBe(`swasth-dose-${time}`);
  expect(nudge.actions).toEqual(['Taken']);
  expect(nudge.data).toEqual({ url: '/', day, times: [time] });
  await sw.clear();

  // Tapping Taken (the service worker's handler for that button).
  await sw.worker.evaluate(data => markTakenFromNotification(data), { day, times: [time] });
  // The open app records both doses...
  await expect(item('Metformin')).toHaveClass(/taken/);
  await expect(item('Amlodipine')).toHaveClass(/taken/);
  await expect(page.locator('#medToast')).toContainText('2 doses marked Taken from a reminder');
  // ...and the pack counts down, which leaves a week's supply: a warning, once.
  await expect(page.locator('.refill-item', { hasText: 'Metformin' })).toContainText('7 of 8 left');
  await expect.poll(sw.shown).toEqual([{ title: 'Metformin is running low', body: 'About 7 days left (7 left). Time to reorder.', tag: expect.stringMatching(/^swasth-refill-/) }]);
  await sw.clear();
  await sw.worker.evaluate(async () => alertLowRefills(await readState(DOSES_URL, null)));
  expect(await sw.shown()).toEqual([]);

  // Nothing is recorded twice, and a later nudge for those doses stays quiet.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('swasth_medStatus')).history.length)).toBe(2);
  expect(await sw.worker.evaluate(() => readState(QUEUE_URL, null))).toBeNull();
  await sw.push({ kind: 'nudge', day, times: [time] });
  await page.waitForTimeout(1000);
  expect(await sw.shown()).toEqual([]);
  expect(errors).toEqual([]);
});

test('Taken on a notification while the app is closed is recorded when it next opens', async ({ page, context }) => {
  const { time, day } = nowTime();
  const meds = [{ name: 'Metformin', dose: '1 tablet', schedule: 'Once daily', times: [time] }];
  const sw = await setUp(page, context, meds);
  const tappedAt = Date.now() - 5 * 60000;
  await page.goto('about:blank');
  await sw.worker.evaluate(async ({ day, time, tappedAt }) => {
    // As markTakenFromNotification leaves it, tapped five minutes ago.
    await writeState(QUEUE_URL, [{ day, times: [time], at: tappedAt }]);
  }, { day, time, tappedAt });
  await openApp(page, { medications: meds });
  await expect(page.locator('.today-med-item', { hasText: 'Metformin' })).toHaveClass(/taken/);
  const event = await page.evaluate(() => JSON.parse(localStorage.getItem('swasth_medStatus')).history[0]);
  expect(Date.parse(event.date)).toBe(tappedAt);
});

test('Snooze and Taken go straight to the reminder service', async ({ page, context }) => {
  const { time, day } = nowTime();
  const sw = await setUp(page, context, [{ name: 'Metformin', dose: '1 tablet', schedule: 'Once daily', times: [time] }]);
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/this-phone';
  // A reminder service, and a push subscription, as on a set-up server.
  await sw.worker.evaluate(async endpoint => {
    self.__calls = [];
    self.__offline = false;
    Object.defineProperty(self.registration.pushManager, 'getSubscription', { value: async () => ({ endpoint }) });
    const realFetch = self.fetch;
    self.fetch = async (url, init) => {
      if (!String(url).startsWith('https://push-worker.test/')) return realFetch(url, init);
      if (self.__offline) throw new TypeError('Failed to fetch');
      self.__calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
      return new Response('{"ok":true}', { status: 200 });
    };
    const snapshot = await readState(DOSES_URL, null);
    await writeState(DOSES_URL, { ...snapshot, workerUrl: 'https://push-worker.test' });
  }, ENDPOINT);

  await sw.push({ kind: 'dose', day, times: [time] });
  await expect.poll(async () => (await sw.last())?.actions).toEqual(['Taken', 'Snooze 10 min']);
  const reminder = { title: 'Time for Metformin 1 tablet', tag: `swasth-dose-${time}`, body: 'Tap Taken once you have had it.', data: { url: '/', day, times: [time] } };
  await sw.clear();

  await sw.worker.evaluate(n => snoozeFromNotification(n), reminder);
  expect(await sw.worker.evaluate(() => self.__calls)).toEqual([{ path: '/snooze', body: { endpoint: ENDPOINT, day, times: [time], minutes: 10 } }]);
  expect(await sw.shown()).toEqual([]);

  // Offline: the reminder comes back rather than being lost.
  await sw.worker.evaluate(() => { self.__offline = true; });
  await sw.worker.evaluate(n => snoozeFromNotification(n), reminder);
  expect(await sw.shown()).toEqual([{ title: 'Time for Metformin 1 tablet', body: 'Couldn\'t snooze (no connection). Tap Taken once you have had it.', tag: `swasth-dose-${time}` }]);
  await sw.worker.evaluate(() => { self.__offline = false; self.__calls = []; });

  await sw.worker.evaluate(data => markTakenFromNotification(data), { day, times: [time] });
  expect(await sw.worker.evaluate(() => self.__calls)).toEqual([{ path: '/taken', body: { endpoint: ENDPOINT, day, times: [time] } }]);
});

test('with reminders on, a chip replaces the bar, and says when the server has no push service', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  await page.addInitScript(() => localStorage.setItem('swasth_doseReminders', 'on'));
  await openApp(page, { medications: [{ name: 'Metformin', dose: '500 mg', schedule: 'Once daily', times: ['08:00'] }] });
  // Reminders are on, so the bar is replaced by the chip; its menu explains
  // they only come while the app is open, and offers the calendar instead.
  await expect(page.locator('#doseReminderBar')).toBeHidden();
  await page.click('#reminderChip');
  await expect(page.locator('#reminderMenu')).toBeVisible();
  await expect(page.locator('#reminderMenuStatus')).toContainText('On while SwasthID is open');
  await expect(page.locator('#reminderMenuStatus')).toContainText('add your doses to your calendar');
  await expect(page.locator('#reminderMenu [data-reminder-test]')).toBeHidden();
  await expect(page.locator('#reminderMenu [data-reminder-calendar]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#reminderMenu')).toBeHidden();

  // Turning off brings the bar back as the prompt to turn them on.
  await page.click('#reminderChip');
  await page.click('#reminderMenu [data-reminder-off]');
  await expect(page.locator('#reminderStatus')).toBeHidden();
  await expect(page.locator('#doseReminderBar [data-reminder-toggle]')).toHaveText('Turn on');
});
