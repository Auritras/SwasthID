// SwasthID dose reminders: a Cloudflare Worker (free plan) with a D1 database.
//
// - The SwasthID server saves each browser's dose times here (PUT
//   /subscriptions/:id), authenticated with a shared secret. Browsers never
//   call this Worker directly.
// - Every minute a cron trigger finds the doses due now in each time zone and
//   sends an empty push to those browsers. The service worker on the phone
//   then shows which medicines are due.

import { sendPush, isPushEndpoint } from './webpush.js';

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const MAX_DOSES = 48;
const SEND_CONCURRENCY = 6;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// Weekday, day of month and HH:MM at `date` in time zone `tz`.
export function localTime(date, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(p => [p.type, p.value]));
  return { weekday: WEEKDAYS[parts.weekday], monthDay: Number(parts.day), time: `${parts.hour}:${parts.minute}` };
}

// Constant-time comparison of the shared secret.
async function authorized(request, env) {
  if (!env.SHARED_SECRET || env.SHARED_SECRET.length < 16) return false;
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, env.SHARED_SECRET].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function parseDoses(list) {
  if (!Array.isArray(list) || list.length > MAX_DOSES) return null;
  const seen = new Set();
  const out = [];
  for (const d of list) {
    const time = String(d?.time || '');
    const days = Number(d?.days);
    const monthDay = d?.monthDay == null ? null : Number(d.monthDay);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
    if (!Number.isInteger(days) || days < 1 || days > 127) return null;
    if (monthDay !== null && !(Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 31)) return null;
    const key = `${time}|${days}|${monthDay}`;
    if (!seen.has(key)) { seen.add(key); out.push({ time, days, monthDay }); }
  }
  return out;
}

async function removeSubscriptions(env, where, value) {
  const ids = (await env.DB.prepare(`SELECT id FROM subscriptions WHERE ${where} = ?`).bind(value).all()).results.map(r => r.id);
  if (!ids.length) return 0;
  await env.DB.batch(ids.flatMap(id => [
    env.DB.prepare('DELETE FROM doses WHERE sub_id = ?').bind(id),
    env.DB.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id),
  ]));
  await env.DB.prepare('DELETE FROM zones WHERE tz NOT IN (SELECT DISTINCT tz FROM doses)').run();
  return ids.length;
}

async function saveSubscription(env, id, body) {
  const uid = String(body?.uid || '');
  const endpoint = String(body?.endpoint || '');
  const tz = body?.tz;
  const doses = parseDoses(body?.doses);
  if (!uid || uid.length > 128) return json(400, { error: 'uid is required.' });
  if (!isPushEndpoint(endpoint) || endpoint.length > 1024) return json(400, { error: 'Not a supported push endpoint.' });
  if (!validTimeZone(tz)) return json(400, { error: 'Unknown time zone.' });
  if (!doses) return json(400, { error: 'doses must be up to 48 entries of { time: "HH:MM", days: 1-127, monthDay? }.' });

  // Replace everything stored for this browser in one transaction.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM doses WHERE sub_id = ?').bind(id),
    env.DB.prepare(`INSERT INTO subscriptions (id, uid, endpoint, tz, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET uid = excluded.uid, endpoint = excluded.endpoint, tz = excluded.tz, updated_at = excluded.updated_at`)
      .bind(id, uid, endpoint, tz, Date.now()),
    ...doses.map(d => env.DB.prepare('INSERT INTO doses (sub_id, tz, time, days, month_day) VALUES (?, ?, ?, ?, ?)').bind(id, tz, d.time, d.days, d.monthDay)),
    env.DB.prepare('INSERT INTO zones (tz) VALUES (?) ON CONFLICT (tz) DO NOTHING').bind(tz),
  ]);
  await env.DB.prepare('DELETE FROM zones WHERE tz NOT IN (SELECT DISTINCT tz FROM doses)').run();
  return json(200, { ok: true, doses: doses.length });
}

async function sendAll(env, targets, fetchImpl) {
  const results = { sent: 0, gone: 0, failed: 0 };
  const queue = [...targets];
  async function worker() {
    for (let t = queue.shift(); t; t = queue.shift()) {
      try {
        const status = await sendPush(t.endpoint, env, { fetchImpl });
        if (status === 404 || status === 410) {
          results.gone++;
          await removeSubscriptions(env, 'id', t.id);
        } else if (status >= 200 && status < 300) results.sent++;
        else { results.failed++; console.warn(`Push to ${new URL(t.endpoint).host} answered ${status}`); }
      } catch (e) {
        results.failed++;
        console.warn('Push failed:', e.message);
      }
    }
  }
  await Promise.all(Array.from({ length: SEND_CONCURRENCY }, worker));
  return results;
}

// Send a push to every browser with a dose due at `when` (to the minute).
export async function sendDueReminders(env, when = new Date(), fetchImpl = fetch) {
  const zones = (await env.DB.prepare('SELECT tz FROM zones').all()).results.map(r => r.tz);
  const targets = new Map();
  for (const tz of zones) {
    if (!validTimeZone(tz)) continue;
    const now = localTime(when, tz);
    const rows = (await env.DB.prepare(`SELECT DISTINCT s.id, s.endpoint FROM doses d JOIN subscriptions s ON s.id = d.sub_id
      WHERE d.tz = ? AND d.time = ? AND (d.days & ?) != 0 AND (d.month_day IS NULL OR d.month_day = ?)`)
      .bind(tz, now.time, 1 << now.weekday, now.monthDay).all()).results;
    for (const r of rows) targets.set(r.id, r);
  }
  return sendAll(env, [...targets.values()], fetchImpl);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json(200, { ok: true, service: 'swasthid-push' });
    if (!(await authorized(request, env))) return json(401, { error: 'Unauthorized.' });

    const sub = /^\/subscriptions\/([a-f0-9]{64})(\/test)?$/.exec(url.pathname);
    const user = /^\/users\/([^/]{1,128})$/.exec(url.pathname);
    try {
      if (sub && !sub[2] && request.method === 'PUT') return await saveSubscription(env, sub[1], await request.json().catch(() => null));
      if (sub && !sub[2] && request.method === 'DELETE') return json(200, { ok: true, removed: await removeSubscriptions(env, 'id', sub[1]) });
      if (sub && sub[2] && request.method === 'POST') {
        const row = await env.DB.prepare('SELECT id, endpoint FROM subscriptions WHERE id = ?').bind(sub[1]).first();
        if (!row) return json(404, { error: 'Not subscribed.' });
        const result = await sendAll(env, [row], fetch);
        return json(result.sent ? 200 : 502, result);
      }
      if (user && request.method === 'DELETE') return json(200, { ok: true, removed: await removeSubscriptions(env, 'uid', decodeURIComponent(user[1])) });
    } catch (e) {
      console.error('Request failed:', e);
      return json(500, { error: 'Server error.' });
    }
    return json(404, { error: 'Not found.' });
  },

  async scheduled(controller, env, ctx) {
    // scheduledTime is the minute the cron was due, even if it starts late.
    ctx.waitUntil(sendDueReminders(env, new Date(controller.scheduledTime)).then(r => {
      if (r.sent || r.gone || r.failed) console.log(`Reminders: ${r.sent} sent, ${r.gone} unsubscribed, ${r.failed} failed`);
    }));
  },
};
