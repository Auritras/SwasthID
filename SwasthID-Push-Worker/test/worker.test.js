// Worker tests: `npm test` (Node 22.13+, for the built-in SQLite).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, createPublicKey } from 'node:crypto';
import worker, { sendDueReminders, localTime } from '../src/index.js';
import { vapidToken, base64urlDecode, base64urlEncode, isPushEndpoint } from '../src/webpush.js';
import { createD1 } from './d1.js';

const SECRET = 'test-shared-secret-0123456789';
let env, keys;

async function makeKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { jwk, publicKey: base64urlEncode(new Uint8Array([4, ...base64urlDecode(jwk.x), ...base64urlDecode(jwk.y)])), privateKey: jwk.d };
}

beforeEach(async () => {
  keys ??= await makeKeys();
  env = { DB: createD1(), SHARED_SECRET: SECRET, VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:test@example.com' };
});

const id = n => String(n).repeat(64).slice(0, 64);
const endpoint = n => `https://fcm.googleapis.com/fcm/send/device-${n}`;

function call(method, path, body, secret = SECRET) {
  const headers = { Authorization: `Bearer ${secret}` };
  return worker.fetch(new Request(`https://push.example${path}`, { method, headers, body: body && JSON.stringify(body) }), env);
}

function fakePushService(statusFor = () => 201) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: statusFor(url) }); };
  return { calls, fetchImpl };
}

test('local time follows the time zone, including the weekday and day of month', () => {
  const when = new Date('2026-09-30T18:45:00Z'); // a Wednesday
  assert.deepEqual(localTime(when, 'Asia/Kolkata'), { weekday: 4, monthDay: 1, time: '00:15' });
  assert.deepEqual(localTime(when, 'UTC'), { weekday: 3, monthDay: 30, time: '18:45' });
  assert.deepEqual(localTime(when, 'America/New_York'), { weekday: 3, monthDay: 30, time: '14:45' });
});

test('requests need the shared secret', async () => {
  assert.equal((await call('PUT', `/subscriptions/${id(1)}`, {}, 'wrong-secret-0123456789')).status, 401);
  assert.equal((await call('PUT', `/subscriptions/${id(1)}`, {}, '')).status, 401);
  assert.equal((await worker.fetch(new Request('https://push.example/health'), env)).status, 200);
});

test('saving checks the endpoint, time zone and doses', async () => {
  const ok = { uid: 'u1', endpoint: endpoint(1), tz: 'Asia/Kolkata', doses: [{ time: '08:00', days: 127 }] };
  for (const bad of [
    { ...ok, endpoint: 'https://evil.example/push' },
    { ...ok, endpoint: 'http://fcm.googleapis.com/fcm/send/x' },
    { ...ok, tz: 'Mars/Olympus' },
    { ...ok, doses: [{ time: '8:00', days: 127 }] },
    { ...ok, doses: [{ time: '08:00', days: 0 }] },
    { ...ok, doses: [{ time: '08:00', days: 127, monthDay: 32 }] },
    { ...ok, doses: Array.from({ length: 49 }, () => ({ time: '08:00', days: 127 })) },
    { ...ok, uid: '' },
  ]) {
    assert.equal((await call('PUT', `/subscriptions/${id(1)}`, bad)).status, 400, JSON.stringify(bad).slice(0, 80));
  }
  assert.equal((await call('PUT', `/subscriptions/${id(1)}`, ok)).status, 200);
  assert.equal((await call('PUT', '/subscriptions/not-a-hash', ok)).status, 404);
});

test('each minute, only browsers with a dose due right then get a push', async () => {
  // Kolkata is UTC+5:30. Wednesday 30 Sep 2026, 08:00 there = 02:30 UTC.
  await call('PUT', `/subscriptions/${id(1)}`, { uid: 'a', endpoint: endpoint(1), tz: 'Asia/Kolkata', doses: [{ time: '08:00', days: 127 }, { time: '20:00', days: 127 }] });
  await call('PUT', `/subscriptions/${id(2)}`, { uid: 'b', endpoint: endpoint(2), tz: 'Asia/Kolkata', doses: [{ time: '08:00', days: (1 << 1) | (1 << 4) }] }); // Mon, Thu
  await call('PUT', `/subscriptions/${id(3)}`, { uid: 'c', endpoint: endpoint(3), tz: 'Asia/Kolkata', doses: [{ time: '08:00', days: 127, monthDay: 30 }] });
  await call('PUT', `/subscriptions/${id(4)}`, { uid: 'd', endpoint: endpoint(4), tz: 'Europe/London', doses: [{ time: '08:00', days: 127 }] });

  const push = fakePushService();
  const result = await sendDueReminders(env, new Date('2026-09-30T02:30:00Z'), push.fetchImpl);
  assert.deepEqual(push.calls.map(c => c.url).sort(), [endpoint(1), endpoint(3)]);
  assert.equal(result.sent, 2);

  // An empty push with a VAPID signature and a short time to live.
  const { headers } = push.calls[0].init;
  assert.equal(push.calls[0].init.method, 'POST');
  assert.equal(push.calls[0].init.body, undefined);
  assert.match(headers.Authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.publicKey}$`));
  assert.equal(headers.TTL, '1800');

  // London's 08:00 is 07:00 UTC in summer time.
  const later = fakePushService();
  await sendDueReminders(env, new Date('2026-09-30T07:00:00Z'), later.fetchImpl);
  assert.deepEqual(later.calls.map(c => c.url), [endpoint(4)]);

  // Thursday 08:00 in Kolkata: the Mon/Thu medicine is due, the monthly one isn't.
  const thursday = fakePushService();
  await sendDueReminders(env, new Date('2026-10-01T02:30:00Z'), thursday.fetchImpl);
  assert.deepEqual(thursday.calls.map(c => c.url).sort(), [endpoint(1), endpoint(2)]);
});

test('two medicines at the same time mean one push', async () => {
  await call('PUT', `/subscriptions/${id(1)}`, { uid: 'a', endpoint: endpoint(1), tz: 'UTC', doses: [{ time: '09:00', days: 127 }, { time: '09:00', days: 1 << 3 }] });
  const push = fakePushService();
  await sendDueReminders(env, new Date('2026-09-30T09:00:00Z'), push.fetchImpl);
  assert.equal(push.calls.length, 1);
});

test('saving again replaces the old times, and a browser that unsubscribed is forgotten', async () => {
  await call('PUT', `/subscriptions/${id(1)}`, { uid: 'a', endpoint: endpoint(1), tz: 'UTC', doses: [{ time: '09:00', days: 127 }] });
  await call('PUT', `/subscriptions/${id(1)}`, { uid: 'a', endpoint: endpoint(1), tz: 'UTC', doses: [{ time: '10:00', days: 127 }] });
  const at9 = fakePushService();
  await sendDueReminders(env, new Date('2026-09-30T09:00:00Z'), at9.fetchImpl);
  assert.equal(at9.calls.length, 0);

  const gone = fakePushService(() => 410);
  const result = await sendDueReminders(env, new Date('2026-09-30T10:00:00Z'), gone.fetchImpl);
  assert.equal(result.gone, 1);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM doses').get().n, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM zones').get().n, 0);
});

test('deleting a browser or a whole account removes its reminders', async () => {
  await call('PUT', `/subscriptions/${id(1)}`, { uid: 'a', endpoint: endpoint(1), tz: 'UTC', doses: [{ time: '09:00', days: 127 }] });
  await call('PUT', `/subscriptions/${id(2)}`, { uid: 'a', endpoint: endpoint(2), tz: 'Asia/Kolkata', doses: [{ time: '09:00', days: 127 }] });
  await call('PUT', `/subscriptions/${id(3)}`, { uid: 'b', endpoint: endpoint(3), tz: 'UTC', doses: [{ time: '09:00', days: 127 }] });

  assert.deepEqual(await (await call('DELETE', `/subscriptions/${id(3)}`)).json(), { ok: true, removed: 1 });
  assert.deepEqual(await (await call('DELETE', '/users/a')).json(), { ok: true, removed: 2 });
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM doses').get().n, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM zones').get().n, 0);
});

test('the VAPID token is a valid ES256 JWT for the push service', async () => {
  const jwt = await vapidToken({ audience: 'https://fcm.googleapis.com', subject: 'mailto:test@example.com', publicKey: keys.publicKey, privateKey: keys.privateKey });
  const [header, claims, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const body = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(body.aud, 'https://fcm.googleapis.com');
  assert.equal(body.sub, 'mailto:test@example.com');
  assert.ok(body.exp > Date.now() / 1000 && body.exp <= Date.now() / 1000 + 24 * 3600);
  const { d, ...pub } = keys.jwk;
  const verifier = createVerify('SHA256');
  verifier.update(`${header}.${claims}`);
  assert.ok(verifier.verify({ key: createPublicKey({ key: pub, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
});

test('the one-file version for the Cloudflare dashboard is up to date and works', async () => {
  const { bundle } = await import('../scripts/bundle.js');
  const { readFileSync } = await import('node:fs');
  const file = new URL('../dist/worker.js', import.meta.url);
  assert.equal(readFileSync(file, 'utf8'), bundle(), 'dist/worker.js is out of date: run `npm run bundle`');
  assert.doesNotMatch(readFileSync(file, 'utf8'), /^(import |export (?!default))/m);

  const { default: single } = await import(file.href);
  const req = (method, path, body) => new Request(`https://push.example${path}`, { method, headers: { Authorization: `Bearer ${SECRET}` }, body: body && JSON.stringify(body) });
  assert.equal((await single.fetch(req('PUT', `/subscriptions/${id(1)}`, { uid: 'a', endpoint: endpoint(1), tz: 'UTC', doses: [{ time: '09:00', days: 127 }] }), env)).status, 200);

  // The cron handler sends to the due browser.
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => { sent.push(url); return new Response(null, { status: 201 }); };
  try {
    const waits = [];
    await single.scheduled({ scheduledTime: Date.parse('2026-09-30T09:00:00Z') }, env, { waitUntil: p => waits.push(p) });
    await Promise.all(waits);
  } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(sent, [endpoint(1)]);
});

test('only known push services are accepted as endpoints', () => {
  assert.ok(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'));
  assert.ok(isPushEndpoint('https://web.push.apple.com/QGx'));
  assert.ok(!isPushEndpoint('https://fcm.googleapis.com.evil.example/x'));
  assert.ok(!isPushEndpoint('https://127.0.0.1/x'));
  assert.ok(!isPushEndpoint('not a url'));
});
