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
    if (url.pathname.startsWith('/api/') || url.pathname === '/record-share' || url.pathname === '/health') return;
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

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) return existing.focus();
    return self.clients.openWindow('/');
  })());
});
