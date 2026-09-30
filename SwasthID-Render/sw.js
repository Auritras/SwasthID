// SwasthID service worker.
//
// 1. Offline start. On install it saves the page and every file it links to
//    in /assets, plus the Firebase SDK and fonts, so the app opens without a
//    connection. The app's own files are fetched network-first, so a new
//    deploy shows up on the next online visit; the cached copy is only a
//    fallback. Versioned CDN libraries are served from the cache first.
//    /api/* calls and anything not listed below always go to the network.
// 2. Dose-reminder notifications (Android Chrome can't show them from the
//    page itself), and bringing the app forward when one is tapped.

const CACHE = 'swasthid-v1';
// Hosts whose URLs are versioned, so a cached copy never goes stale.
const CDN_HOSTS = ['www.gstatic.com', 'fonts.gstatic.com', 'fonts.googleapis.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];
const FIREBASE_SDK = ['app', 'auth', 'firestore'].map(m => `https://www.gstatic.com/firebasejs/12.18.0/firebase-${m}-compat.js`);
const NAV_TIMEOUT_MS = 4000;

async function precache() {
  const cache = await caches.open(CACHE);
  const res = await fetch('/', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not fetch the app page (HTTP ${res.status}).`);
  const html = await res.clone().text();
  await cache.put('/', res);
  // Everything the page links to under /assets, and the web config.
  const local = new Set(['/firebase-config.js', '/assets/site.webmanifest']);
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"#?]+)"/g)) local.add(m[1]);
  await Promise.all([...local].map(url => cache.add(new Request(url, { cache: 'no-store' })).catch(() => {})));
  // Cross-origin scripts and styles are loaded without CORS, so store them
  // the same way (opaque responses).
  const fonts = [...html.matchAll(/href="(https:\/\/fonts\.googleapis\.com\/[^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  await Promise.all([...FIREBASE_SDK, ...fonts].map(async url => {
    try { await cache.put(url, await fetch(url, { mode: 'no-cors' })); } catch (_) {}
  }));
}

self.addEventListener('install', event => {
  event.waitUntil(precache().catch(err => console.warn('SwasthID offline cache not ready:', err)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('swasthid-') && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, { timeout = 0, fallbackUrl = null } = {}) {
  const cache = await caches.open(CACHE);
  try {
    const network = fetch(request);
    const res = timeout
      ? await Promise.race([network, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))])
      : await network;
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' }) || (fallbackUrl && await cache.match(fallbackUrl));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // Live data and share pages are never served from the cache.
    if (url.pathname.startsWith('/api/') || url.pathname === '/record-share' || url.pathname === '/health' || url.pathname === '/auth/action') return;
    if (request.mode === 'navigate') {
      // A QR scan (/?emergency=...) needs the network to decrypt the card.
      if (url.searchParams.has('emergency')) return;
      event.respondWith(networkFirst(request, { timeout: NAV_TIMEOUT_MS, fallbackUrl: '/' }));
      return;
    }
    event.respondWith(networkFirst(request));
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(request));
});

// ---- Dose reminders pushed while the app is closed ----
// The push itself is empty: it only says "a dose is due now". Which medicines
// are due comes from the copy of today's schedule the app keeps here
// (dose-reminders.js), so medicine names never leave the device.
const STATE_CACHE = 'swasth-state'; // not removed when the app cache is updated
const DOSES_URL = '/__swasth/doses.json';
const DUE_WINDOW_BEFORE = 20; // minutes a dose can be late and still count as "now"
const DUE_WINDOW_AFTER = 5;

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function readDoseSnapshot() {
  try {
    const res = await (await caches.open(STATE_CACHE)).match(DOSES_URL);
    return res ? await res.json() : null;
  } catch (_) {
    return null;
  }
}

// Doses scheduled around `now`, split into those still to take and those
// already marked taken today.
function dosesAround(snapshot, now) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const today = localDateKey(now);
  const around = (snapshot?.doses || []).filter(d => {
    const [h, m] = String(d.time).split(':').map(Number);
    const diff = minutes - (h * 60 + m);
    return diff >= -DUE_WINDOW_AFTER && diff <= DUE_WINDOW_BEFORE
      && (d.days & (1 << now.getDay())) !== 0
      && (d.monthDay == null || d.monthDay === now.getDate());
  });
  return { due: around.filter(d => d.takenOn !== today), taken: around.filter(d => d.takenOn === today) };
}

const TEST_URL = '/__swasth/push-test';

// The app's "Send a test" button leaves a note here just before asking for a
// test push, so that push isn't mistaken for a dose.
async function takeTestNote() {
  try {
    const cache = await caches.open(STATE_CACHE);
    const note = await cache.match(TEST_URL);
    if (!note) return false;
    await cache.delete(TEST_URL);
    return Date.now() - Number(await note.text()) < 5 * 60 * 1000;
  } catch (_) {
    return false;
  }
}

async function showDueDoses() {
  if (await takeTestNote()) {
    return self.registration.showNotification('Dose reminders are working', {
      icon: '/assets/icon-192.png', badge: '/assets/icon-192.png', data: { url: '/' }, tag: 'swasth-push-test',
      body: 'You will get a notification like this at each dose time, even when SwasthID is closed.',
    });
  }
  const { due, taken } = dosesAround(await readDoseSnapshot(), new Date());
  // Everything due now is already marked taken: nothing to remind about.
  if (!due.length && taken.length) return;
  const options = { icon: '/assets/icon-192.png', badge: '/assets/icon-192.png', data: { url: '/' }, renotify: true };
  if (!due.length) {
    return self.registration.showNotification('Time for your medicines', { ...options, tag: 'swasth-dose-due', body: 'Open SwasthID to see what is due and mark it taken.' });
  }
  const time = due[0].time;
  const title = due.length === 1 ? `Time for ${due[0].label}` : `Time for ${due.length} medicines`;
  const body = due.length === 1
    ? `${due[0].detail ? due[0].detail + ' · ' : ''}Open SwasthID to mark it taken.`
    : `${due.map(d => d.label).join(', ')}. Open SwasthID to mark them taken.`;
  return self.registration.showNotification(title, { ...options, tag: `swasth-dose-${time}`, body });
}

self.addEventListener('push', event => {
  event.waitUntil(showDueDoses());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) return existing.focus();
    return self.clients.openWindow('/');
  })());
});
