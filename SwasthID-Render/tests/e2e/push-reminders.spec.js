// What the service worker shows when a dose-reminder push arrives. The push
// is empty; the medicines come from the schedule the app saved on the device.
// Pushes are delivered through Chrome DevTools, as a push service would.
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
  return {
    push: () => cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: '' }),
    shown: () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ title: n.title, body: n.body, tag: n.tag }))),
    badges: () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => new URL(n.badge).pathname)),
    clear: () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).forEach(n => n.close())),
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
  await expect.poll(sw.shown).toEqual([{ title: 'Time for 2 medicines', body: 'Metformin 500 mg, Amlodipine 5 mg. Open SwasthID to mark them taken.', tag: `swasth-dose-${time}` }]);
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
  await expect.poll(sw.shown).toEqual([{ title: 'Time for Metformin 500 mg', body: 'Open SwasthID to mark it taken.', tag: `swasth-dose-${time}` }]);
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

test('the reminder bar offers calendar reminders when the server has no push service', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  await page.addInitScript(() => localStorage.setItem('swasth_doseReminders', 'on'));
  await openApp(page, { medications: [{ name: 'Metformin', dose: '500 mg', schedule: 'Once daily', times: ['08:00'] }] });
  await expect(page.locator('#doseReminderBar')).toContainText('while SwasthID is open');
  await expect(page.locator('#doseReminderBar')).toContainText('add your doses to your calendar');
  await expect(page.locator('[data-reminder-test]')).toHaveCount(0);
});
