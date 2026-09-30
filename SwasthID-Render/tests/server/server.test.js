// Server tests: `npm test`. Starts server.js on a free port with a fake
// Overpass server, then checks static files and the JSON APIs.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

let server, mock, base, mockBase;
const mockCalls = [];

function listen(srv) {
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

async function startServer(env) {
  const probe = http.createServer();
  const port = await listen(probe); // ask the OS for a free port, then release it
  await new Promise(r => probe.close(r));
  const child = spawn(process.execPath, [path.join(__dirname, '../../server.js')], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url + '/health')).ok) return { child, url }; } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('server did not start');
}

before(async () => {
  // Fake Overpass: /ok answers, /busy is rate limited, /timeout returns the
  // 200-with-remark that real servers send when a query runs out of time.
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      mockCalls.push({ path: req.url, ua: req.headers['user-agent'], body });
      const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url.startsWith('/ok')) return json(200, { elements: [{ id: 1, lat: 22.57, lon: 88.36, tags: { name: 'City Hospital', amenity: 'hospital' } }] });
      if (req.url.startsWith('/busy')) return json(429, {});
      return json(200, { elements: [], remark: 'runtime error: Query timed out in "query" at line 3' });
    });
  });
  mockBase = `http://127.0.0.1:${await listen(mock)}`;
  ({ child: server, url: base } = await startServer({ DEMO_MODE: '1', OVERPASS_URLS: `${mockBase}/busy,${mockBase}/ok` }));
});

after(() => {
  server?.kill();
  mock?.close();
});

test('/health reports the service and which features are on', async () => {
  const body = await (await fetch(base + '/health')).json();
  assert.equal(body.ok, true);
  assert.equal(body.nearby, true);
  assert.equal(typeof body.version, 'string');
});

test('the page is served with absolute share links', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes('__ORIGIN__'));
  assert.ok(html.includes(`content="${base}/assets/og-image.png"`));
  assert.ok(html.includes('<script src="/assets/js/cloud-sync.js"></script>'));
});

test('static assets have the right types and nothing outside assets/ is served', async () => {
  const types = { '/assets/app.css': 'text/css', '/assets/js/pwa.js': 'text/javascript', '/assets/favicon.svg': 'image/svg+xml', '/sw.js': 'application/javascript' };
  for (const [url, type] of Object.entries(types)) {
    const res = await fetch(base + url);
    assert.equal(res.status, 200, url);
    assert.ok(res.headers.get('content-type').startsWith(type), url);
  }
  for (const url of ['/assets/../server.js', '/assets/%2e%2e/server.js', '/assets/js/../../package.json', '/assets/nope.js']) {
    assert.equal((await fetch(base + url)).status, 404, url);
  }
});

test('demo mode serves an empty Firebase config', async () => {
  const js = await (await fetch(base + '/firebase-config.js')).text();
  assert.equal(js.trim(), 'window.SWASTH_FIREBASE_CONFIG = {};');
});

test('/api/nearby needs valid coordinates', async () => {
  for (const q of ['', '?lat=&lon=', '?lat=22.5', '?lat=abc&lon=1', '?lat=91&lon=0', '?lat=0&lon=181']) {
    assert.equal((await fetch(base + '/api/nearby' + q)).status, 400, q);
  }
});

test('/api/nearby moves on from a busy map server and identifies itself', async () => {
  mockCalls.length = 0;
  const res = await fetch(base + '/api/nearby?lat=22.5726&lon=88.3639');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.elements[0].tags.name, 'City Hospital');
  assert.deepEqual(mockCalls.map(c => c.path), ['/busy', '/ok']);
  assert.match(mockCalls[1].ua, /^SwasthID\//);
  const query = decodeURIComponent(mockCalls[1].body.replace(/^data=/, '').replace(/\+/g, ' '));
  assert.match(query, /\[bbox:[\d.,-]+\]/);
  assert.match(query, /around:10000,22\.5726,88\.3639/);

  // A second search from the same spot comes from the cache.
  mockCalls.length = 0;
  const again = await (await fetch(base + '/api/nearby?lat=22.5726&lon=88.3639')).json();
  assert.equal(again.cached, true);
  assert.equal(mockCalls.length, 0);
});

test('/api/nearby reports every server\'s reason when all fail', async () => {
  const { child, url } = await startServer({ DEMO_MODE: '1', OVERPASS_URLS: `${mockBase}/busy,${mockBase}/timeout` });
  try {
    const res = await fetch(url + '/api/nearby?lat=10&lon=10');
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.reasons.length, 2);
    assert.match(body.reasons[0], /HTTP 429/);
    assert.match(body.reasons[1], /timed out/);
  } finally { child.kill(); }
});

test('/api/nearby limits each client to 30 searches in 10 minutes', async () => {
  const { child, url } = await startServer({ DEMO_MODE: '1', OVERPASS_URLS: `${mockBase}/ok` });
  try {
    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await fetch(`${url}/api/nearby?lat=1&lon=${i}`)).status);
    assert.equal(statuses.filter(s => s === 200).length, 30);
    assert.equal(statuses[30], 429);
  } finally { child.kill(); }
});

test('password reset: bad addresses are refused, and without email set up the app is told to use Firebase', async () => {
  const post = body => fetch(base + '/api/auth/password-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  for (const body of ['{}', '{"email":"not-an-email"}', 'not json']) {
    assert.equal((await post(body)).status, 400, body);
  }
  const res = await post('{"email":"someone@example.com"}');
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { fallback: true });
  const verify = await fetch(base + '/api/auth/send-verification', { method: 'POST' });
  assert.equal(verify.status, 503);
  assert.deepEqual(await verify.json(), { fallback: true });
});

test('push reminders are off until the Worker is set up, and their APIs say so', async () => {
  assert.deepEqual(await (await fetch(base + '/api/push/config')).json(), { enabled: false, publicKey: '' });
  assert.equal((await (await fetch(base + '/health')).json()).pushReminders, false);
  for (const url of ['/api/push/subscribe', '/api/push/unsubscribe', '/api/push/test']) {
    const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 503, url);
  }
});

test('/auth/action is served without caching or referrers', async () => {
  const res = await fetch(base + '/auth/action?mode=verifyEmail&oobCode=abc');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.ok((await res.text()).includes('/assets/js/auth-action.js'));
});

test('account email templates escape the address and include a plain-text link', () => {
  const mail = require('../../mail');
  const url = 'https://app.example/auth/action?mode=resetPassword&oobCode=x&lang=en';
  const reset = mail.passwordResetEmail({ email: '<b>x</b>@example.com', url, origin: 'https://app.example' });
  assert.ok(reset.html.includes('&lt;b&gt;x&lt;/b&gt;@example.com'));
  assert.ok(!reset.html.includes('<b>x</b>'));
  assert.ok(reset.html.includes('href="https://app.example/auth/action?mode=resetPassword&amp;oobCode=x&amp;lang=en"'));
  assert.ok(reset.html.includes('src="https://app.example/assets/icon-192.png"'));
  assert.ok(reset.text.includes(url));
  const verify = mail.verificationEmail({ email: 'a@example.com', url, origin: 'https://app.example' });
  assert.equal(verify.subject, 'Confirm your email for SwasthID');
  assert.ok(verify.text.includes(url));
});

test('APIs that change an account refuse requests without a user or token', async () => {
  // Doctor links and account deletion need a signed-in user (503 here, as
  // this server has no Firebase Admin); revoking a QR needs its revoke token.
  for (const url of ['/api/record-share/create', '/api/account/delete', '/api/emergency/revoke']) {
    const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.ok([400, 401, 403, 503].includes(res.status), `${url} answered ${res.status}`);
  }
});
