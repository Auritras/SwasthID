// Reminders when the app is closed: the app, signed in, hands its dose times
// to our server, which passes them to the push Worker (a fake one here that
// records what it gets). The browser's push subscription is faked too, as
// tests can't reach a real push service.
const http = require('node:http');
const crypto = require('node:crypto');
const { test, expect } = require('../e2e/fixtures');
const { createUser, idToken, logIn } = require('./helpers');

test.use({ signedIn: false });

const WORKER_PORT = 2526; // matches PUSH_WORKER_URL for the emulator server in playwright.config.js
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-device';
const SUB_ID = crypto.createHash('sha256').update(ENDPOINT).digest('hex');
const received = [];
let worker;

test.beforeAll(async () => {
  worker = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      // /taken and /snooze are called by the app itself, from another origin.
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      received.push({ method: req.method, path: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null, raw: body });
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify({ ok: true, sent: 1 }));
    });
  });
  await new Promise(resolve => worker.listen(WORKER_PORT, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise(resolve => worker.close(resolve));
});

test.beforeEach(async ({ context }) => {
  received.length = 0;
  await context.grantPermissions(['notifications']);
  // A browser push subscription without a push service behind it.
  await context.addInitScript(endpoint => {
    // Like a real one, the subscription outlives a reload.
    const saved = sessionStorage.getItem('__fakePushKey');
    const makeSub = key => ({
      endpoint,
      options: { applicationServerKey: Uint8Array.from(key).buffer },
      toJSON: () => ({ endpoint, keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-key' } }),
      unsubscribe: async () => { state.sub = null; sessionStorage.removeItem('__fakePushKey'); window.__pushUnsubscribed = true; return true; },
    });
    const state = { sub: saved ? makeSub(JSON.parse(saved)) : null };
    const reg = {
      showNotification: async () => {},
      pushManager: {
        getSubscription: async () => state.sub,
        subscribe: async ({ applicationServerKey }) => {
          const key = [...new Uint8Array(applicationServerKey)];
          sessionStorage.setItem('__fakePushKey', JSON.stringify(key));
          state.sub = makeSub(key);
          return state.sub;
        },
      },
    };
    window.PushManager ||= function PushManager() {};
    Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(reg) });
    navigator.serviceWorker.getRegistration = async () => reg;
    navigator.serviceWorker.register = async () => reg;
  }, ENDPOINT);
});

const MEDICATIONS = [
  { name: 'Metformin', dose: '500 mg', schedule: 'Twice daily', times: ['08:00', '20:00'] },
  { name: 'Methotrexate', dose: '7.5 mg', schedule: 'Once daily', times: ['09:00'], days: [1, 4] },
  { name: 'Vitamin D3', dose: '60000 IU', schedule: 'Once daily', times: ['08:00'] },
];

async function setMedications(page, medications) {
  await page.evaluate(meds => { patientData.medications = meds; renderPersonalizedUI(); }, medications);
}

const puts = () => received.filter(r => r.method === 'PUT');

test('turning reminders on sends dose times, never names, and keeps them up to date', async ({ page }) => {
  const user = await createUser('push');
  await logIn(page, user);
  await setMedications(page, MEDICATIONS);
  await page.evaluate(() => document.querySelector('[data-reminder-toggle]').click());
  await expect(page.locator('#medToast')).toContainText('even when SwasthID is closed');

  await expect.poll(() => puts().length).toBe(1);
  const put = puts()[0];
  expect(put.path).toBe(`/subscriptions/${SUB_ID}`);
  expect(put.auth).toBe('Bearer test-only-push-secret-0123456789');
  expect(put.body).toEqual({
    uid: user.uid,
    endpoint: ENDPOINT,
    tz: await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    doses: [
      { time: '08:00', days: 127, monthDay: null },
      { time: '20:00', days: 127, monthDay: null },
      { time: '09:00', days: (1 << 1) | (1 << 4), monthDay: null },
    ],
    // So the Worker can encrypt what it sends to this browser.
    keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-key' },
  });
  expect(put.raw).not.toMatch(/Metformin|Methotrexate|Vitamin/);
  // Once on, the bar gives way to a "Reminders on" chip by the list's title.
  await expect(page.locator('#doseReminderBar')).toBeHidden();
  await expect(page.locator('#reminderChip')).toBeVisible();
  await expect(page.locator('#reminderMenuStatus')).toContainText('even when SwasthID is closed');

  // A changed time is sent again; an unchanged schedule is not.
  await setMedications(page, [{ ...MEDICATIONS[0], times: ['07:30', '20:00'] }]);
  await expect.poll(() => puts().length).toBe(2);
  expect(puts()[1].body.doses).toEqual([{ time: '07:30', days: 127, monthDay: null }, { time: '20:00', days: 127, monthDay: null }]);
  await page.evaluate(() => renderPersonalizedUI());
  await page.waitForTimeout(2500);
  expect(puts().length).toBe(2);

  // Test push.
  await page.evaluate(() => document.querySelector('[data-reminder-test]').click());
  await expect(page.locator('#medToast')).toContainText('A notification should arrive');
  expect(received.some(r => r.method === 'POST' && r.path === `/subscriptions/${SUB_ID}/test`)).toBe(true);

  // Turning off (from the chip's menu) removes this browser from the Worker.
  await page.click('#reminderChip');
  await page.click('#reminderMenu [data-reminder-off]');
  await expect.poll(() => received.some(r => r.method === 'DELETE' && r.path === `/subscriptions/${SUB_ID}`)).toBe(true);
  expect(await page.evaluate(() => window.__pushUnsubscribed)).toBe(true);
  await expect(page.locator('#doseReminderBar')).toContainText('Get a notification at each dose time');
});

test('once every dose at a time is marked taken, the app tells the Worker (so no nudge comes)', async ({ page }) => {
  const user = await createUser('push-taken');
  await logIn(page, user);
  await setMedications(page, MEDICATIONS);
  await page.evaluate(() => document.querySelector('[data-reminder-toggle]').click());
  await expect.poll(() => puts().length).toBe(1);
  const takenCalls = () => received.filter(r => r.method === 'POST' && r.path === '/taken');
  // The list is in time order, so the first Metformin is the 08:00 dose.
  const mark = name => page.locator('.today-med-item', { hasText: name }).first().locator('.med-action').click();

  // Metformin and Vitamin D3 are both at 08:00: one of them isn't enough.
  await mark('Metformin');
  await page.waitForTimeout(1500);
  expect(takenCalls()).toEqual([]);
  await mark('Vitamin D3');
  await expect.poll(() => takenCalls().length).toBe(1);
  const day = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  // Straight to the Worker (no shared secret: the endpoint is the proof), with no names.
  expect(takenCalls()[0]).toMatchObject({ auth: undefined, body: { endpoint: ENDPOINT, day, times: ['08:00'] } });
  // Not sent again while nothing changes.
  await page.evaluate(() => window.refreshDoseReminders());
  await page.waitForTimeout(1500);
  expect(takenCalls().length).toBe(1);
});

test('logging out stops this browser getting the account\'s reminders', async ({ page }) => {
  const user = await createUser('push-logout');
  await logIn(page, user);
  await setMedications(page, MEDICATIONS);
  await page.evaluate(() => document.querySelector('[data-reminder-toggle]').click());
  await expect.poll(() => puts().length).toBe(1);

  await page.evaluate(() => document.getElementById('logoutBtn').click());
  await expect(page.locator('#loginScreen')).toBeVisible();
  await expect.poll(() => received.some(r => r.method === 'DELETE' && r.path === `/subscriptions/${SUB_ID}`)).toBe(true);
  expect(await page.evaluate(() => caches.has('swasth-state'))).toBe(false);
});

test('reminders turned on before pushes were available start pushing without asking again', async ({ page }) => {
  const user = await createUser('push-upgrade');
  await logIn(page, user);
  // In-app reminders only, as saved by an older version of SwasthID.
  await page.evaluate(uid => { localStorage.setItem('swasth_doseReminders', 'on'); localStorage.setItem('swasth_remindersOwner', uid); }, user.uid);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('dashboard')?.style.display === 'block' && typeof firebaseUser !== 'undefined' && !!firebaseUser);
  await setMedications(page, MEDICATIONS);
  await expect.poll(() => puts().length).toBe(1);
  expect(puts()[0].body.uid).toBe(user.uid);
});

test('reminders stay on across reloads, but not for another account on the same browser', async ({ page }) => {
  const first = await createUser('push-reload');
  await logIn(page, first);
  await setMedications(page, MEDICATIONS);
  await page.evaluate(() => document.querySelector('[data-reminder-toggle]').click());
  await expect.poll(() => puts().length).toBe(1);

  await page.reload();
  await page.waitForFunction(() => document.getElementById('dashboard')?.style.display === 'block' && typeof firebaseUser !== 'undefined' && !!firebaseUser);
  expect(await page.evaluate(() => [localStorage.getItem('swasth_doseReminders'), localStorage.getItem('swasth_pushReminders')])).toEqual(['on', 'on']);

  // Someone else signs in on this browser without logging the first one out.
  const second = await createUser('push-other');
  await page.evaluate(async ({ email, password }) => { await auth.signInWithEmailAndPassword(email, password); }, second);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('swasth_doseReminders'))).toBeNull();
  // The first account's pushes stop, and its schedule is gone from the device.
  await expect.poll(() => page.evaluate(() => window.__pushUnsubscribed)).toBe(true);
  expect(await page.evaluate(() => caches.has('swasth-state'))).toBe(false);
});

test('the push APIs need a signed-in user, and deleting the account removes its reminders', async ({ baseURL }) => {
  const res = await fetch(`${baseURL}/api/push/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: ENDPOINT, tz: 'UTC', doses: [] }) });
  expect(res.status).toBe(401);
  expect(await (await fetch(`${baseURL}/api/push/config`)).json()).toEqual({ enabled: true, publicKey: expect.stringMatching(/^B[\w-]{86}$/), workerUrl: `http://127.0.0.1:${WORKER_PORT}` });

  const user = await createUser('push-delete');
  const del = await fetch(`${baseURL}/api/account/delete`, { method: 'POST', headers: { Authorization: `Bearer ${await idToken(user)}` } });
  expect(del.status).toBe(200);
  expect(received.some(r => r.method === 'DELETE' && r.path === `/users/${user.uid}`)).toBe(true);
});
