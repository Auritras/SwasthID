// Worker tests: `npm test` (Node 22.13+, for the built-in SQLite).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, createPublicKey, createECDH, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import worker, { sendDueReminders, localTime } from '../src/index.js';
import { vapidToken, base64urlDecode, base64urlEncode, isPushEndpoint, encryptPayload } from '../src/webpush.js';
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
const sha256 = async text => createHash('sha256').update(text).digest('hex');

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
  assert.deepEqual(localTime(when, 'Asia/Kolkata'), { weekday: 4, day: '2026-10-01', monthDay: 1, time: '00:15' });
  assert.deepEqual(localTime(when, 'UTC'), { weekday: 3, day: '2026-09-30', monthDay: 30, time: '18:45' });
  assert.deepEqual(localTime(when, 'America/New_York'), { weekday: 3, day: '2026-09-30', monthDay: 30, time: '14:45' });
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

// A browser's push keys, and how that browser decrypts a message (RFC 8291),
// written with node:crypto rather than the Worker's WebCrypto code.
function makeBrowser(n) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    endpoint: endpoint(n),
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
    decrypt(body) {
      const buf = Buffer.from(body);
      const salt = buf.subarray(0, 16);
      assert.equal(buf.readUInt32BE(16), 4096);
      const idlen = buf[20];
      const asPublic = buf.subarray(21, 21 + idlen);
      const cipher = buf.subarray(21 + idlen);
      const shared = ecdh.computeSecret(asPublic);
      const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]);
      const ikm = Buffer.from(hkdfSync('sha256', shared, auth, info, 32));
      const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
      decipher.setAuthTag(cipher.subarray(cipher.length - 16));
      const plain = Buffer.concat([decipher.update(cipher.subarray(0, cipher.length - 16)), decipher.final()]);
      assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
      return JSON.parse(plain.subarray(0, plain.length - 1).toString());
    },
  };
}

function phoneCall(path, body, method = 'POST') {
  return worker.fetch(new Request(`https://push.example${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }), env);
}

test('with the browser\'s keys, the push carries an encrypted message only that browser can read', async () => {
  const phone = makeBrowser(1);
  await call('PUT', `/subscriptions/${await sha256(phone.endpoint)}`, { uid: 'a', endpoint: phone.endpoint, tz: 'UTC', keys: phone.keys, doses: [{ time: '09:00', days: 127 }] });
  const push = fakePushService();
  await sendDueReminders(env, new Date('2026-09-30T09:00:00Z'), push.fetchImpl);
  assert.equal(push.calls.length, 1);
  const { headers, body } = push.calls[0].init;
  assert.equal(headers['Content-Encoding'], 'aes128gcm');
  assert.equal(headers['Content-Length'], String(body.length));
  assert.deepEqual(phone.decrypt(body), { kind: 'dose', day: '2026-09-30', times: ['09:00'] });
  // A fresh key and salt each time: the same message never looks the same.
  const again = await encryptPayload(phone.keys, 'same');
  assert.notDeepEqual(await encryptPayload(phone.keys, 'same'), again);
  assert.throws(() => makeBrowser(2).decrypt(body));

  for (const bad of [{ p256dh: 'short', auth: phone.keys.auth }, { p256dh: phone.keys.p256dh, auth: 'x' }, 'text']) {
    assert.equal((await call('PUT', `/subscriptions/${await sha256(phone.endpoint)}`, { uid: 'a', endpoint: phone.endpoint, tz: 'UTC', keys: bad, doses: [] })).status, 400);
  }
});

test('a dose not marked taken gets a nudge 30 minutes later; a taken one does not', async () => {
  const phone = makeBrowser(1), laptop = makeBrowser(2), old = makeBrowser(3);
  for (const b of [phone, laptop]) await call('PUT', `/subscriptions/${await sha256(b.endpoint)}`, { uid: 'a', endpoint: b.endpoint, tz: 'Asia/Kolkata', keys: b.keys, doses: [{ time: '08:00', days: 127 }, { time: '20:00', days: 127 }] });
  // Saved before this version: no keys, so no nudge (it couldn't say which dose).
  await call('PUT', `/subscriptions/${await sha256(old.endpoint)}`, { uid: 'b', endpoint: old.endpoint, tz: 'Asia/Kolkata', doses: [{ time: '08:00', days: 127 }] });

  // 08:30 in Kolkata = 03:00 UTC.
  const nudge = fakePushService();
  await sendDueReminders(env, new Date('2026-09-30T03:00:00Z'), nudge.fetchImpl);
  assert.deepEqual(nudge.calls.map(c => c.url).sort(), [phone.endpoint, laptop.endpoint]);
  assert.deepEqual(phone.decrypt(nudge.calls.find(c => c.url === phone.endpoint).init.body), { kind: 'nudge', day: '2026-09-30', times: ['08:00'] });

  // Taken on the phone: neither device is nudged about it, but the evening dose still comes.
  assert.equal((await phoneCall('/taken', { endpoint: phone.endpoint, day: '2026-09-30', times: ['08:00'] })).status, 200);
  const after = fakePushService();
  await sendDueReminders(env, new Date('2026-09-30T03:00:00Z'), after.fetchImpl);
  assert.equal(after.calls.length, 0);
  // Taken early (before 20:00): no reminder at 20:00 either.
  await phoneCall('/taken', { endpoint: laptop.endpoint, day: '2026-09-30', times: ['20:00'] });
  const evening = fakePushService();
  await sendDueReminders(env, new Date('2026-09-30T14:30:00Z'), evening.fetchImpl);
  assert.equal(evening.calls.length, 0);
  // Un-ticked in the app: the app sends the full list for the day, and the nudge is back.
  await phoneCall('/taken', { endpoint: phone.endpoint, day: '2026-09-30', times: [], replace: true });
  const back = fakePushService();
  await sendDueReminders(env, new Date('2026-09-30T03:00:00Z'), back.fetchImpl);
  assert.equal(back.calls.length, 2);
  // The next day starts fresh.
  const tomorrow = fakePushService();
  await phoneCall('/taken', { endpoint: phone.endpoint, day: '2026-09-30', times: ['08:00'] });
  await sendDueReminders(env, new Date('2026-10-01T02:30:00Z'), tomorrow.fetchImpl);
  assert.equal(tomorrow.calls.length, 3);
});

test('snooze reminds again after 10 minutes, unless the dose is taken first', async () => {
  const phone = makeBrowser(1);
  await call('PUT', `/subscriptions/${await sha256(phone.endpoint)}`, { uid: 'a', endpoint: phone.endpoint, tz: 'UTC', keys: phone.keys, doses: [{ time: '09:00', days: 127 }] });
  const tapped = Date.parse('2026-09-30T09:01:10Z');
  const realNow = Date.now;
  Date.now = () => tapped;
  try {
    const res = await phoneCall('/snooze', { endpoint: phone.endpoint, day: '2026-09-30', times: ['09:00'] });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal((await res.json()).at, Date.parse('2026-09-30T09:11:00Z'));
  } finally { Date.now = realNow; }

  const early = fakePushService();
  await sendDueReminders(env, new Date('2026-09-30T09:10:00Z'), early.fetchImpl);
  assert.equal(early.calls.length, 0);
  const due = fakePushService();
  await sendDueReminders(env, new Date('2026-09-30T09:11:00Z'), due.fetchImpl);
  assert.deepEqual(phone.decrypt(due.calls[0].init.body), { kind: 'snooze', day: '2026-09-30', times: ['09:00'] });
  // Sent once only.
  const later = fakePushService();
  await sendDueReminders(env, new Date('2026-09-30T09:12:00Z'), later.fetchImpl);
  assert.equal(later.calls.length, 0);

  // Snoozed, then taken: the snooze is dropped.
  await phoneCall('/snooze', { endpoint: phone.endpoint, day: '2026-09-30', times: ['09:00'], minutes: 1 });
  await phoneCall('/taken', { endpoint: phone.endpoint, day: '2026-09-30', times: ['09:00'] });
  const dropped = fakePushService();
  await sendDueReminders(env, new Date(Date.now() + 5 * 60000), dropped.fetchImpl);
  assert.equal(dropped.calls.length, 0);
});

test('the phone\'s calls need a real subscription and valid times', async () => {
  const phone = makeBrowser(1);
  await call('PUT', `/subscriptions/${await sha256(phone.endpoint)}`, { uid: 'a', endpoint: phone.endpoint, tz: 'UTC', keys: phone.keys, doses: [{ time: '09:00', days: 127 }] });
  const preflight = await phoneCall('/snooze', undefined, 'OPTIONS');
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
  assert.equal((await phoneCall('/taken', { endpoint: endpoint(9), day: '2026-09-30', times: ['09:00'] })).status, 404);
  assert.equal((await phoneCall('/taken', { endpoint: 'https://evil.example/x', day: '2026-09-30', times: ['09:00'] })).status, 404);
  for (const bad of [{ day: '30-09-2026', times: ['09:00'] }, { day: '2026-09-30', times: ['9am'] }, { day: '2026-09-30', times: [] }, { day: '2026-09-30' }]) {
    assert.equal((await phoneCall('/snooze', { endpoint: phone.endpoint, ...bad })).status, 400, JSON.stringify(bad));
  }
  for (let i = 0; i < 10; i++) await phoneCall('/snooze', { endpoint: phone.endpoint, day: '2026-09-30', times: ['09:00'] });
  assert.equal((await phoneCall('/snooze', { endpoint: phone.endpoint, day: '2026-09-30', times: ['09:00'] })).status, 429);
  // Deleting the account forgets its snoozes and taken doses too.
  await phoneCall('/taken', { endpoint: phone.endpoint, day: '2026-09-30', times: ['09:00'] });
  await call('DELETE', '/users/a');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM snoozes').get().n, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM taken').get().n, 0);
});

test('a database made by the previous version is upgraded on first use', async () => {
  const oldSchema = `CREATE TABLE subscriptions (id TEXT PRIMARY KEY, uid TEXT NOT NULL, endpoint TEXT NOT NULL, tz TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE doses (sub_id TEXT NOT NULL, tz TEXT NOT NULL, time TEXT NOT NULL, days INTEGER NOT NULL, month_day INTEGER);
    CREATE TABLE zones (tz TEXT PRIMARY KEY);
    INSERT INTO subscriptions VALUES ('${id(7)}', 'a', '${endpoint(7)}', 'UTC', 0);
    INSERT INTO doses VALUES ('${id(7)}', 'UTC', '09:00', 127, NULL);
    INSERT INTO zones VALUES ('UTC');`;
  env.DB = createD1(oldSchema);
  const push = fakePushService();
  await sendDueReminders(env, new Date('2026-09-30T09:00:00Z'), push.fetchImpl);
  assert.deepEqual(push.calls.map(c => c.url), [endpoint(7)]);
  assert.equal(push.calls[0].init.body, undefined); // no keys yet: an empty push, as before

  const phone = makeBrowser(1);
  assert.equal((await call('PUT', `/subscriptions/${await sha256(phone.endpoint)}`, { uid: 'a', endpoint: phone.endpoint, tz: 'UTC', keys: phone.keys, doses: [{ time: '09:00', days: 127 }] })).status, 200);
  assert.equal((await phoneCall('/taken', { endpoint: phone.endpoint, day: '2026-09-30', times: ['09:00'] })).status, 200);
});

test('only known push services are accepted as endpoints', () => {
  assert.ok(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'));
  assert.ok(isPushEndpoint('https://web.push.apple.com/QGx'));
  assert.ok(!isPushEndpoint('https://fcm.googleapis.com.evil.example/x'));
  assert.ok(!isPushEndpoint('https://127.0.0.1/x'));
  assert.ok(!isPushEndpoint('not a url'));
});
