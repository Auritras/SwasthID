// SwasthID service worker.
//
// 1. Offline start. On install it saves the page and every file it links to
//    in /assets, plus the Firebase SDK and fonts, so the app opens without a
//    connection. The app's own files are fetched network-first, so a new
//    deploy shows up on the next online visit; the cached copy is only a
//    fallback. Versioned CDN libraries are served from the cache first.
//    /api/* calls and anything not listed below always go to the network.
// 2. Dose-reminder notifications (Android Chrome can't show them from the
//    page itself) with Taken and Snooze buttons, warnings when a pack is
//    running low, and bringing the app forward when one is tapped.

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
// The push says only what kind of reminder it is and for which dose times
// (older setups send an empty push, meaning "a dose is due now"). Which
// medicines those are comes from the copy of the schedule the app keeps here
// (dose-reminders.js), so medicine names never leave the device.
const STATE_CACHE = 'swasth-state'; // not removed when the app cache is updated
const DOSES_URL = '/__swasth/doses.json';
const QUEUE_URL = '/__swasth/taken-queue.json'; // marked Taken on a notification, for the app to record
const ALERTS_URL = '/__swasth/refill-alerts.json'; // low-stock warnings already shown
const TEST_URL = '/__swasth/push-test';
const DUE_WINDOW_BEFORE = 20; // minutes a dose can be late and still count as "now"
const DUE_WINDOW_AFTER = 5;
const SNOOZE_MINUTES = 10;
const LOW_DAYS = 7; // same as the Refill reminders panel
const NOTIFICATION = { icon: '/assets/icon-192.png', badge: '/assets/badge-96.png' };

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function dateFromKey(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function formatTime(time) {
  const [h, m] = String(time).split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function readState(url, fallback) {
  try {
    const res = await (await caches.open(STATE_CACHE)).match(url);
    return res ? await res.json() : fallback;
  } catch (_) {
    return fallback;
  }
}
async function writeState(url, value) {
  await (await caches.open(STATE_CACHE)).put(url, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
}

function scheduledOn(d, date) {
  return (d.days & (1 << date.getDay())) !== 0 && (d.monthDay == null || d.monthDay === date.getDate());
}

// Doses scheduled around `now`, split into those still to take and those
// already marked taken today.
function dosesAround(snapshot, now) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const today = localDateKey(now);
  const around = (snapshot?.doses || []).filter(d => {
    const [h, m] = String(d.time).split(':').map(Number);
    const diff = minutes - (h * 60 + m);
    return diff >= -DUE_WINDOW_AFTER && diff <= DUE_WINDOW_BEFORE && scheduledOn(d, now);
  });
  return { due: around.filter(d => d.takenOn !== today), taken: around.filter(d => d.takenOn === today) };
}

// The doses a push is about: the day and times it names, or, for an empty
// push, those due around now.
function dosesFor(snapshot, message, now) {
  if (message && typeof message.day === 'string' && Array.isArray(message.times)) {
    const date = dateFromKey(message.day);
    const list = (snapshot?.doses || []).filter(d => message.times.includes(d.time) && scheduledOn(d, date));
    return { day: message.day, times: message.times, due: list.filter(d => d.takenOn !== message.day), taken: list.filter(d => d.takenOn === message.day) };
  }
  const { due, taken } = dosesAround(snapshot, now);
  return { day: localDateKey(now), times: [...new Set(due.map(d => d.time))], due, taken };
}

// The app's "Send a test" button leaves a note here just before asking for a
// test push, so an empty test push isn't mistaken for a dose.
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

async function showReminder(message) {
  const testNote = await takeTestNote();
  if (message?.kind === 'test' || (!message && testNote)) {
    return self.registration.showNotification('Dose reminders are working', {
      ...NOTIFICATION, data: { url: '/' }, tag: 'swasth-push-test',
      body: 'You will get a notification like this at each dose time, even when SwasthID is closed.',
    });
  }
  const snapshot = await readState(DOSES_URL, null);
  const { day, times, due, taken } = dosesFor(snapshot, message, new Date());
  // Everything this is about is already marked taken: nothing to remind about.
  if (!due.length && taken.length) return;
  const kind = message?.kind || 'dose';
  const options = { ...NOTIFICATION, renotify: true, data: { url: '/', day, times } };
  if (times.length) {
    options.actions = [{ action: 'taken', title: 'Taken' }];
    if (snapshot?.workerUrl) options.actions.push({ action: 'snooze', title: `Snooze ${SNOOZE_MINUTES} min` });
  }
  // One tag per dose time, so a nudge or snooze replaces the earlier reminder.
  const tag = times.length ? `swasth-dose-${times.join('-')}` : 'swasth-dose-due';
  const when = times.length ? formatTime(times[0]) : '';
  const names = due.map(d => d.label).join(', ');
  let title, body;
  if (!due.length) {
    title = kind === 'nudge' ? 'Did you take your medicines?' : 'Time for your medicines';
    body = 'Open SwasthID to see what is due and mark it taken.';
  } else if (kind === 'nudge') {
    title = due.length === 1 ? `Did you take ${due[0].label}?` : `Did you take your ${when} medicines?`;
    body = `Due at ${when}${due.length > 1 ? `: ${names}` : ''}. Not marked taken yet.`;
  } else {
    title = due.length === 1 ? `Time for ${due[0].label}` : `Time for ${due.length} medicines`;
    const detail = due.length === 1 ? due[0].detail : names;
    body = `${kind === 'snooze' ? 'Snoozed reminder. ' : ''}${detail ? detail + '. ' : ''}${options.actions ? `Tap Taken once you have had ${due.length === 1 ? 'it' : 'them'}.` : 'Open SwasthID to mark it taken.'}`;
  }
  await self.registration.showNotification(title, { ...options, tag, body });
  if (kind === 'dose') await alertLowRefills(snapshot);
}

// Days a pack lasts, the same sum as the Refill reminders panel.
function supplyDays(r) {
  if (!(r.perDay > 0)) return null;
  return r.monthly ? Math.floor(r.left / r.perDay) * 30 : Math.floor(r.left / r.perDay / (r.daysPerWeek || 7) * 7);
}

// Warn once when a pack is running low, and once more when it runs out.
async function alertLowRefills(snapshot) {
  if (!snapshot?.refills?.length) return;
  const shown = await readState(ALERTS_URL, {});
  const alerts = [];
  for (const r of snapshot.refills) {
    const days = supplyDays(r);
    const stage = r.left <= 0 || days === 0 ? 'out' : days != null && days <= LOW_DAYS ? 'low' : null;
    const id = `${r.key}|${r.at}|${stage}`;
    if (!stage || shown[id]) continue;
    shown[id] = Date.now();
    alerts.push(self.registration.showNotification(stage === 'out' ? `Time to refill ${r.name}` : `${r.name} is running low`, {
      ...NOTIFICATION, tag: `swasth-refill-${r.key}`, data: { url: '/' },
      body: stage === 'out'
        ? `${r.left > 0 ? `Only ${r.left} left` : 'None left'}. When you get a new pack, tap Refilled in SwasthID.`
        : `About ${days} day${days === 1 ? '' : 's'} left (${r.left} left). Time to reorder.`,
    }));
  }
  if (!alerts.length) return;
  // Forget warnings older than 90 days.
  for (const [id, at] of Object.entries(shown)) if (Date.now() - at > 90 * 86400000) delete shown[id];
  await writeState(ALERTS_URL, shown);
  await Promise.all(alerts);
}

// Tell the reminder service straight away (no nudge for a taken dose; a
// snooze to send). The push endpoint shows which browser this is.
async function tellReminderService(snapshot, path, body) {
  if (!snapshot?.workerUrl) return false;
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (!sub) return false;
    const res = await fetch(snapshot.workerUrl + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, ...body }),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function markTakenFromNotification({ day, times }) {
  if (!day || !times?.length) return;
  // The app records these as taken (at this time) the next time it opens.
  const queue = await readState(QUEUE_URL, []);
  queue.push({ day, times, at: Date.now() });
  await writeState(QUEUE_URL, queue.slice(-100));
  const snapshot = await readState(DOSES_URL, null);
  if (snapshot) {
    const date = dateFromKey(day);
    for (const d of snapshot.doses || []) {
      if (!times.includes(d.time) || !scheduledOn(d, date) || d.takenOn === day) continue;
      d.takenOn = day;
      const r = (snapshot.refills || []).find(x => x.key === d.refill);
      if (r) r.left = Math.max(0, r.left - (d.units || 1));
    }
    await writeState(DOSES_URL, snapshot);
  }
  const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  pages.forEach(client => client.postMessage({ type: 'swasth-taken' }));
  await Promise.all([tellReminderService(snapshot, '/taken', { day, times }), alertLowRefills(snapshot)]);
}

async function snoozeFromNotification(notification) {
  const { day, times } = notification.data || {};
  const snapshot = await readState(DOSES_URL, null);
  if (await tellReminderService(snapshot, '/snooze', { day, times, minutes: SNOOZE_MINUTES })) return;
  // No connection: put the reminder back rather than lose it.
  return self.registration.showNotification(notification.title, {
    ...NOTIFICATION, tag: notification.tag, data: notification.data, actions: [{ action: 'taken', title: 'Taken' }],
    body: `Couldn't snooze (no connection). ${notification.body}`,
  });
}

self.addEventListener('push', event => {
  let message = null;
  try { message = event.data ? event.data.json() : null; } catch (_) {}
  event.waitUntil(showReminder(message));
});

self.addEventListener('notificationclick', event => {
  const notification = event.notification;
  notification.close();
  if (event.action === 'taken') return event.waitUntil(markTakenFromNotification(notification.data || {}));
  if (event.action === 'snooze') return event.waitUntil(snoozeFromNotification(notification));
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) return existing.focus();
    return self.clients.openWindow('/');
  })());
});
