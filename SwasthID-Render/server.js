const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mail = require('./mail');

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const ROOT = __dirname;

const DRUGSETU_API_KEY = process.env.DRUGSETU_API_KEY || '';
const RISK_API_URL = (process.env.RISK_API_URL || '').replace(/\/$/, '');
const EMERGENCY_SECRET = process.env.EMERGENCY_SECRET || '';

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || '';
const FIREBASE_PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

// DEMO_MODE=1 serves an empty Firebase config, so the app runs without an
// account and keeps data in the browser. When the Firebase emulator variables
// are set (tests, local development), Admin and the web app both use them.
const DEMO_MODE = process.env.DEMO_MODE === '1';
const USING_EMULATORS = !DEMO_MODE && Boolean(FIREBASE_PROJECT_ID && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST);

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

const MAX_BODY_BYTES = 250000;
const MAX_RECORD_SHARE_BYTES = 180000;
const RECORD_SHARE_TTL_MS = 24 * 60 * 60 * 1000;
const EMERGENCY_TTL_DAYS = Math.min(
  730,
  Math.max(1, Number(process.env.EMERGENCY_TTL_DAYS || 180) || 180)
);
const EMERGENCY_TTL_MS = EMERGENCY_TTL_DAYS * 24 * 60 * 60 * 1000;
const MAX_ACCESS_LOG = 50;

let firebaseAdmin = null;
let firebaseInitError = null;

function tryInitFirebaseAdmin() {
  // Against the local emulators, Firebase Admin needs only the project ID.
  if (USING_EMULATORS) {
    firebaseAdmin = require('firebase-admin');
    if (!firebaseAdmin.apps.length) firebaseAdmin.initializeApp({ projectId: FIREBASE_PROJECT_ID });
    return;
  }
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    firebaseInitError = new Error(
      'Firebase Admin environment variables are not configured.'
    );
    return;
  }

  try {
    firebaseAdmin = require('firebase-admin');

    if (!firebaseAdmin.apps.length) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert({
          projectId: FIREBASE_PROJECT_ID,
          clientEmail: FIREBASE_CLIENT_EMAIL,
          privateKey: FIREBASE_PRIVATE_KEY
        })
      });
    }
  } catch (e) {
    firebaseInitError = e;
    console.warn(
      'Firebase Admin initialization failed:',
      e.message
    );
  }
}

tryInitFirebaseAdmin();

if (!firebaseAdmin) {
  console.warn(
    'WARNING: Firebase Admin is not configured. Doctor share links and emergency QR revocations are kept in memory and reset when the server restarts.'
  );
}

if (!EMERGENCY_SECRET) {
  console.warn(
    'WARNING: EMERGENCY_SECRET is not set. Emergency token creation is disabled.'
  );
}

function corsHeaders() {
  const origin = ALLOWED_ORIGIN === '*' ? '*' : ALLOWED_ORIGIN;

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers':
      'Content-Type, Accept, Authorization',
    'Access-Control-Allow-Methods':
      'GET, POST, DELETE, OPTIONS',
    'Vary': 'Origin'
  };
}

function json(res, status, body, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(),
    ...extraHeaders
  };

  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    ...corsHeaders()
  });

  res.end(body);
}

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64url(str) {
  return Buffer.from(
    String(str)
      .replace(/-/g, '+')
      .replace(/_/g, '/'),
    'base64'
  );
}

function secretKey() {
  return crypto
    .createHash('sha256')
    .update(EMERGENCY_SECRET)
    .digest();
}

function hashToken(token) {
  return crypto
    .createHash('sha256')
    .update(String(token))
    .digest('hex');
}

function encryptEmergency(payload) {
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    secretKey(),
    iv
  );

  const plaintext = Buffer.from(
    JSON.stringify(payload),
    'utf8'
  );

  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final()
  ]);

  return [
    'v1',
    base64url(iv),
    base64url(cipher.getAuthTag()),
    base64url(encrypted)
  ].join('.');
}

function decryptEmergency(token) {
  const [
    version,
    ivPart,
    tagPart,
    dataPart
  ] = String(token).split('.');

  if (
    version !== 'v1' ||
    !ivPart ||
    !tagPart ||
    !dataPart ||
    !EMERGENCY_SECRET
  ) {
    throw new Error('Invalid emergency token');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    secretKey(),
    fromBase64url(ivPart)
  );

  decipher.setAuthTag(fromBase64url(tagPart));

  const decrypted = Buffer.concat([
    decipher.update(fromBase64url(dataPart)),
    decipher.final()
  ]);

  return JSON.parse(
    decrypted.toString('utf8')
  );
}

// Share links and emergency badges must survive restarts (Render instances
// sleep when idle), so they live in server-only Firestore collections when
// Firebase Admin is configured. Without it they fall back to process memory.
function createStore(collectionName) {
  const memory = new Map();
  const collection = () =>
    firebaseAdmin ? firebaseAdmin.firestore().collection(collectionName) : null;

  return {
    async get(id) {
      const c = collection();
      if (!c) return memory.get(id) || null;
      const snap = await c.doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    async set(id, value) {
      const c = collection();
      if (!c) return void memory.set(id, value);
      await c.doc(id).set(value);
    },
    async update(id, patch) {
      const c = collection();
      if (!c) {
        const current = memory.get(id);
        if (current) memory.set(id, { ...current, ...patch });
        return;
      }
      await c.doc(id).set(patch, { merge: true });
    },
    async delete(id) {
      const c = collection();
      if (!c) return void memory.delete(id);
      await c.doc(id).delete();
    },
    async listWhere(field, value) {
      const c = collection();
      if (!c) return [...memory.values()].filter(item => item[field] === value);
      const snap = await c.where(field, '==', value).get();
      return snap.docs.map(doc => doc.data());
    },
    async updateWhere(field, value, patch) {
      const c = collection();
      if (!c) {
        for (const [id, item] of memory) {
          if (item[field] === value) memory.set(id, { ...item, ...patch });
        }
        return;
      }
      const snap = await c.where(field, '==', value).get();
      await Promise.all(snap.docs.map(doc => doc.ref.set(patch, { merge: true })));
    },
    async deleteWhere(field, value) {
      const c = collection();
      if (!c) {
        for (const [id, item] of memory) {
          if (item[field] === value) memory.delete(id);
        }
        return;
      }
      const snap = await c.where(field, '==', value).get();
      await Promise.all(snap.docs.map(doc => doc.ref.delete()));
    },
    pruneMemory(isExpired) {
      for (const [id, item] of memory) {
        if (!item || isExpired(item)) memory.delete(id);
      }
    }
  };
}

const recordShareStore = createStore('recordShares');
const emergencyBadgeStore = createStore('emergencyBadges');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function appendAccess(list, entry) {
  return [...(Array.isArray(list) ? list : []), entry].slice(-MAX_ACCESS_LOG);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let settled = false;

    function fail(err) {
      if (settled) return;

      settled = true;
      reject(err);
    }

    req.on('data', chunk => {
      body += chunk;

      if (
        Buffer.byteLength(body, 'utf8') >
        MAX_BODY_BYTES
      ) {
        fail(new Error('Request too large'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (settled) return;

      // Parse first: fail() does nothing once `settled` is set, so a bad
      // body would otherwise leave the request hanging.
      try {
        const parsed = body ? JSON.parse(body) : {};
        settled = true;
        resolve(parsed);
      } catch {
        fail(
          new Error('Invalid JSON')
        );
      }
    });

    req.on('error', fail);
  });
}

function getBearerToken(req) {
  const header = String(
    req.headers.authorization || ''
  );

  if (
    !header
      .toLowerCase()
      .startsWith('bearer ')
  ) {
    return '';
  }

  return header.slice(7).trim();
}

async function requireFirebaseUser(req, res) {
  if (!firebaseAdmin) {
    json(res, 503, {
      error:
        'Authenticated backend services are not configured.',
      detail:
        firebaseInitError
          ? firebaseInitError.message
          : 'Firebase Admin unavailable.'
    });

    return null;
  }

  const token = getBearerToken(req);

  if (!token) {
    json(res, 401, {
      error: 'Authentication required.'
    });

    return null;
  }

  try {
    return await firebaseAdmin
      .auth()
      .verifyIdToken(token);
  } catch {
    json(res, 401, {
      error:
        'Invalid or expired authentication token.'
    });

    return null;
  }
}

function normalizeMedicine(m) {
  return {
    id: m.id || '',
    name:
      m.brand_name ||
      m.name ||
      m.product_name ||
      '',
    salt:
      m.salt ||
      m.composition ||
      '',
    strength: m.strength || '',
    form: m.form || '',
    brand:
      m.brand_name ||
      m.brand ||
      '',
    company:
      m.company ||
      m.manufacturer ||
      '',
    pack:
      m.pack_size ||
      m.pack ||
      '',
    mrp:
      Number(
        m.mrp ??
        m.price ??
        0
      ) || 0,
    gst:
      Number(
        m.gst_pct ??
        m.gst ??
        0
      ) || 0,
    prescriptionRequired:
      Boolean(
        m.prescription_required ??
        m.rx ??
        false
      ),
    cdscoAligned:
      Boolean(
        m.cdsco_aligned ??
        false
      )
  };
}

async function handleMedicine(req, res, url) {
  if (!DRUGSETU_API_KEY) {
    return json(res, 503, {
      error:
        'Medicine API is not configured on the server.'
    });
  }

  const q = String(
    url.searchParams.get('q') || ''
  ).trim();

  const type = String(
    url.searchParams.get('type') ||
    'brand'
  );

  const limit = Math.min(
    30,
    Math.max(
      1,
      Number(
        url.searchParams.get('limit') ||
        10
      )
    )
  );

  if (q.length < 2) {
    return json(res, 400, {
      error:
        'Search query must contain at least 2 characters.'
    });
  }

  const upstream = new URL(
    'https://api.drugsetu.in/v1/medicines/search'
  );

  upstream.searchParams.set('q', q);
  upstream.searchParams.set('type', type);
  upstream.searchParams.set(
    'limit',
    String(limit)
  );

  try {
    const response = await fetch(
      upstream,
      {
        headers: {
          'X-API-Key':
            DRUGSETU_API_KEY,
          'Accept':
            'application/json',
          'Content-Type':
            'application/json'
        }
      }
    );

    const raw =
      await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      data = {
        status: 'error',
        raw
      };
    }

    if (!response.ok) {
      return json(
        res,
        response.status,
        {
          error:
            'DrugSetu request failed',
          details: data
        }
      );
    }

    const rows =
      Array.isArray(data)
        ? data
        : (
          Array.isArray(
            data.medicines
          )
            ? data.medicines
            : Array.isArray(
                data.results
              )
              ? data.results
              : Array.isArray(
                  data.data
                )
                ? data.data
                : Array.isArray(
                    data.products
                  )
                  ? data.products
                  : []
        );

    const medicines =
      rows
        .map(normalizeMedicine)
        .filter(m => m.name);

    return json(res, 200, {
      status:
        data.status ||
        'success',

      total:
        Number(
          data.total ??
          medicines.length
        ),

      medicines,

      source: 'DrugSetu',

      disclaimer:
        'Information sourced from DrugSetu is for informational purposes only. Consult healthcare professionals for medical decisions.'
    });
  } catch (e) {
    return json(res, 502, {
      error:
        'Unable to reach DrugSetu.',
      detail: e.message
    });
  }
}

// Nearby care. The browser sends only its coordinates; the query is built here
// so this can't be used as a general Overpass proxy. The free public servers
// ask callers to identify themselves, which a browser can't do, and they
// rate-limit shared mobile IPs, so asking from the server is more reliable.
// Answers are cached for an hour per ~100 m, and failures are logged.
const OVERPASS_ENDPOINTS = (process.env.OVERPASS_URLS || [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
].join(',')).split(',').map(s => s.trim()).filter(Boolean);
const nearbyCache = new Map();
const nearbyHits = new Map();

// The bounding box lets the map servers use their spatial index, so the
// name and brand patterns only run over places within ~10 km.
function nearbyQuery(lat, lon) {
  const dLat = 10 / 111.32, dLon = 10 / (111.32 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
  const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(v => v.toFixed(5)).join(',');
  return `[out:json][timeout:25][bbox:${bbox}];
(
  nwr["amenity"="hospital"](around:10000,${lat},${lon});
  nwr["amenity"~"^(clinic|doctors)$"](around:5000,${lat},${lon});
  nwr["healthcare"~"^(hospital|clinic|doctor|centre|center|polyclinic)$"](around:5000,${lat},${lon});
  nwr["amenity"="pharmacy"](around:3000,${lat},${lon});
  nwr["healthcare"="pharmacy"](around:3000,${lat},${lon});
  nwr["amenity"="pharmacy"]["name"~"aushadh|generic|amrit",i];
  nwr["amenity"="pharmacy"]["brand"~"aushadh|generic|amrit",i];
);
out center tags qt;`;
}

async function overpassFetch(endpoint, query, signal) {
  const res = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'SwasthID/1.0 (+https://github.com/Auritras/SwasthID)'
    },
    body: 'data=' + encodeURIComponent(query)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // A server that runs out of time still answers 200 with a "remark".
  if (data.remark && /error|timed out|out of memory/i.test(data.remark)) {
    throw new Error(String(data.remark).slice(0, 120));
  }
  return data;
}

// Ask the first server; bring in the next as soon as one fails or after 4 s
// without an answer. First good answer wins and the others are cancelled.
function queryOverpassServers(query) {
  return new Promise((resolve, reject) => {
    const controllers = [], reasons = [];
    let next = 0, failed = 0, done = false, hedge = null;
    const finish = () => { done = true; clearTimeout(hedge); controllers.forEach(c => c.abort()); };
    const start = () => {
      if (done || next >= OVERPASS_ENDPOINTS.length) return;
      const endpoint = OVERPASS_ENDPOINTS[next++];
      const controller = new AbortController();
      controllers.push(controller);
      const timer = setTimeout(() => controller.abort(), 28000);
      clearTimeout(hedge);
      hedge = setTimeout(start, 4000);
      overpassFetch(endpoint, query, controller.signal)
        .then(data => { if (!done) { finish(); resolve(data); } })
        .catch(err => {
          if (done) return;
          failed++;
          reasons.push(`${new URL(endpoint).host}: ${err.name === 'AbortError' ? 'no answer in 28 s' : err.message}`);
          if (next < OVERPASS_ENDPOINTS.length) start();
          else if (failed === next) {
            finish();
            const e = new Error('All map servers failed');
            e.reasons = reasons;
            reject(e);
          }
        })
        .finally(() => clearTimeout(timer));
    };
    start();
  });
}

async function handleNearby(req, res, url) {
  // Missing or blank values must not turn into 0 (a real place in the Atlantic).
  const rawLat = String(url.searchParams.get('lat') ?? '').trim();
  const rawLon = String(url.searchParams.get('lon') ?? '').trim();
  const lat = Number(rawLat), lon = Number(rawLon);
  if (!rawLat || !rawLon || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json(res, 400, { error: 'lat and lon are required.' });
  }

  // 30 searches per 10 minutes per client is plenty for a person.
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const recent = (nearbyHits.get(ip) || []).filter(t => now - t < 600000);
  if (recent.length >= 30) return json(res, 429, { error: 'Too many searches. Try again in a few minutes.' });
  recent.push(now);
  nearbyHits.set(ip, recent);
  if (nearbyHits.size > 5000) nearbyHits.clear();

  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = nearbyCache.get(key);
  if (hit && now - hit.at < 3600000) return json(res, 200, { elements: hit.elements, cached: true });

  try {
    const data = await queryOverpassServers(nearbyQuery(Number(lat.toFixed(4)), Number(lon.toFixed(4))));
    const elements = Array.isArray(data.elements) ? data.elements : [];
    if (nearbyCache.size > 500) nearbyCache.clear();
    nearbyCache.set(key, { at: now, elements });
    return json(res, 200, { elements });
  } catch (err) {
    const reasons = err.reasons || [err.message];
    console.warn('Nearby search failed:', reasons.join(' | '));
    return json(res, 502, { error: 'The map servers did not answer.', reasons });
  }
}

async function handleRisk(req, res) {
  if (!RISK_API_URL) {
    return json(res, 503, {
      error:
        'Risk API is not configured on the server.'
    });
  }

  try {
    const body =
      await readBody(req);

    const response =
      await fetch(
        `${RISK_API_URL}/prevent`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',
            'Accept':
              'application/json'
          },

          body:
            JSON.stringify(body)
        }
      );

    const text =
      await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {
        error:
          'Invalid response from risk service'
      };
    }

    return json(
      res,
      response.status,
      data
    );
  } catch (e) {
    return json(res, 502, {
      error:
        'Unable to reach the PREVENT risk service.',
      detail: e.message
    });
  }
}

async function handleEmergencyCreate(req, res) {
  if (!EMERGENCY_SECRET) {
    return json(res, 503, {
      error: 'Emergency token service is not configured.'
    });
  }

  const p = await readBody(req);
  const manageToken = String(p.manageToken || '').trim();

  if (manageToken.length < 32 || manageToken.length > 128) {
    return json(res, 400, {
      error: 'A manage token is required to create a revocable emergency QR.'
    });
  }

  const list = (value, count, length) =>
    Array.isArray(value)
      ? value.slice(0, count).map(x => String(x).slice(0, length))
      : [];

  const tokenId = base64url(crypto.randomBytes(16));
  const expiresAt = Date.now() + EMERGENCY_TTL_MS;

  const payload = {
    v: 6,
    i: tokenId,
    exp: expiresAt,
    n: String(p.n || 'Unknown patient').slice(0, 120),
    bg: String(p.bg || 'Not provided').slice(0, 30),
    da: String(p.da || 'No known drug allergies').slice(0, 500),
    oa: String(p.oa || 'None recorded').slice(0, 500),
    c: list(p.c, 6, 100),
    m: list(p.m, 5, 140),
    ec: list(p.ec, 3, 100),
    ins: list(p.ins, 2, 100)
  };

  await emergencyBadgeStore.set(tokenId, {
    manageHash: hashToken(manageToken),
    createdAt: Date.now(),
    expiresAt,
    revoked: false,
    accesses: []
  });

  const token = encryptEmergency(payload);
  const origin = getRequestOrigin(req);

  return json(res, 200, {
    url: `${origin}/?emergency=${encodeURIComponent(token)}`,
    tokenId,
    expiresAt,
    revocable: true
  });
}

async function handleEmergencyView(req, res, url) {
  const token = String(url.searchParams.get('token') || '');

  if (!token) {
    return json(res, 400, { error: 'Missing token.' });
  }

  let payload;
  try {
    payload = decryptEmergency(token);
  } catch {
    return json(res, 410, { error: 'Invalid or expired emergency token.' });
  }

  if (!payload.exp || Date.now() > Number(payload.exp)) {
    return json(res, 410, { error: 'Emergency token expired.' });
  }

  if (payload.i) {
    const badge = await emergencyBadgeStore.get(payload.i);

    if (badge && badge.revoked) {
      return json(res, 410, { error: 'Emergency token has been revoked.' });
    }

    if (badge) {
      await emergencyBadgeStore.update(payload.i, {
        accesses: appendAccess(badge.accesses, { at: Date.now() })
      });
    }
  }

  return json(res, 200, { payload });
}

async function findManagedBadge(tokenId, manageToken) {
  if (!tokenId || !manageToken) return { status: 400, error: 'tokenId and manageToken are required.' };

  const badge = await emergencyBadgeStore.get(tokenId);
  if (!badge) return { status: 404, error: 'Emergency QR not found or already expired.' };

  if (!safeEqual(badge.manageHash, hashToken(manageToken))) {
    return { status: 403, error: 'You are not allowed to manage this emergency QR.' };
  }

  return { badge };
}

async function handleEmergencyRevoke(req, res) {
  const body = await readBody(req);
  const tokenId = String(body.tokenId || '').trim();
  const manageToken = String(body.manageToken || '').trim();

  const found = await findManagedBadge(tokenId, manageToken);
  if (found.error) return json(res, found.status, { error: found.error });

  // Every refresh issues a new badge, so revoke all badges this owner created;
  // otherwise an older printed or shared copy would stay valid.
  await emergencyBadgeStore.updateWhere('manageHash', found.badge.manageHash, {
    revoked: true,
    revokedAt: Date.now()
  });

  return json(res, 200, { ok: true, revoked: true });
}

async function handleEmergencyActivity(req, res, url) {
  const tokenId = String(url.searchParams.get('tokenId') || '').trim();
  const manageToken = String(url.searchParams.get('manageToken') || '').trim();

  const found = await findManagedBadge(tokenId, manageToken);
  if (found.error) return json(res, found.status, { error: found.error });

  // Report opens across every badge this owner created, oldest first.
  const badges = await emergencyBadgeStore.listWhere('manageHash', found.badge.manageHash);
  const accessLog = badges
    .flatMap(badge => badge.accesses || [])
    .sort((a, b) => a.at - b.at);

  return json(res, 200, {
    tokenId,
    createdAt: found.badge.createdAt,
    expiresAt: found.badge.expiresAt,
    revoked: Boolean(found.badge.revoked),
    accessLog
  });
}

function cleanupStores() {
  const now = Date.now();
  recordShareStore.pruneMemory(item => now >= item.expiresAt);
  emergencyBadgeStore.pruneMemory(item => now >= item.expiresAt);
}

setInterval(cleanupStores, 10 * 60 * 1000).unref();

function getRequestOrigin(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;

  const proto =
    String(
      req.headers[
        'x-forwarded-proto'
      ] || (req.socket.encrypted ? 'https' : 'http')
    )
      .split(',')[0]
      .trim();

  const host =
    String(
      req.headers[
        'x-forwarded-host'
      ] ||
      req.headers.host ||
      ''
    )
      .split(',')[0]
      .trim();

  return `${proto}://${host}`;
}

// ---- Account emails (password reset, email verification) ----
// Firebase makes the one-time code; we put it in a link to our own
// /auth/action page and send our own email. When this server can't send
// (no SMTP settings, no Firebase Admin), it answers { fallback: true } and the
// app asks Firebase to send its default email instead.

const authMailHits = new Map();

// true when `key` has been used `max` times within `windowMs`.
function authMailLimited(key, max, windowMs) {
  const now = Date.now();
  const recent = (authMailHits.get(key) || []).filter(t => now - t < windowMs);
  if (recent.length >= max) return true;
  recent.push(now);
  authMailHits.set(key, recent);
  if (authMailHits.size > 5000) authMailHits.clear();
  return false;
}

// Links in emails must point at this app, never at whatever Host header a
// request carried (that would let anyone send real reset codes to their own
// site). Render sets RENDER_EXTERNAL_URL; locally, localhost is accepted.
function trustedAppOrigin(req) {
  const configured = PUBLIC_BASE_URL || String(process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  if (configured) return configured;
  const origin = getRequestOrigin(req);
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : '';
}

// Turn Firebase's action link into one for our /auth/action page.
function appActionLink(firebaseLink, origin) {
  const source = new URL(firebaseLink);
  const target = new URL('/auth/action', origin);
  for (const key of ['mode', 'oobCode', 'lang']) {
    const value = source.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }
  return target.toString();
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

async function handlePasswordResetEmail(req, res) {
  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid request.' }); }
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json(res, 400, { error: 'Enter a valid email address.' });
  }

  const origin = trustedAppOrigin(req);
  if (!firebaseAdmin || !mail.configured() || !origin) return json(res, 503, { fallback: true });

  if (authMailLimited(`ip:${clientIp(req)}`, 10, 15 * 60000) || authMailLimited(`reset:${email}`, 3, 60 * 60000)) {
    return json(res, 429, { error: 'Too many reset requests. Please wait a while and try again.' });
  }

  let link;
  try {
    link = await firebaseAdmin.auth().generatePasswordResetLink(email);
  } catch (e) {
    // Same answer whether or not the account exists.
    if (e && (e.code === 'auth/email-not-found' || e.code === 'auth/user-not-found')) return json(res, 200, { ok: true });
    console.error('Password reset link failed:', e && e.message);
    return json(res, 502, { fallback: true });
  }

  try {
    await mail.send({ to: email, ...mail.passwordResetEmail({ email, url: appActionLink(link, origin), origin }) });
  } catch (e) {
    console.error('Password reset email failed:', e && e.message);
    return json(res, 502, { fallback: true });
  }
  return json(res, 200, { ok: true });
}

async function handleVerificationEmail(req, res) {
  const origin = trustedAppOrigin(req);
  if (!firebaseAdmin || !mail.configured() || !origin) return json(res, 503, { fallback: true });

  const user = await requireFirebaseUser(req, res);
  if (!user) return;
  if (!user.email) return json(res, 400, { error: 'This account has no email address.' });

  if (authMailLimited(`verify:${user.uid}`, 3, 60 * 60000)) {
    return json(res, 429, { error: 'A verification email was sent recently. Check your inbox and spam folder.' });
  }

  try {
    const record = await firebaseAdmin.auth().getUser(user.uid);
    if (record.emailVerified) return json(res, 200, { ok: true, alreadyVerified: true });
    const link = await firebaseAdmin.auth().generateEmailVerificationLink(record.email);
    await mail.send({ to: record.email, ...mail.verificationEmail({ email: record.email, url: appActionLink(link, origin), origin }) });
  } catch (e) {
    console.error('Verification email failed:', e && e.message);
    return json(res, 502, { fallback: true });
  }
  return json(res, 200, { ok: true });
}

// ---- Dose reminders when the app is closed (Web Push) ----
// A Cloudflare Worker (SwasthID-Push-Worker/) keeps each browser's dose times
// and sends the pushes, because this server may be asleep at dose time. This
// server only checks who is signed in and passes their times on.

const PUSH_WORKER_URL = (process.env.PUSH_WORKER_URL || '').replace(/\/$/, '');
const PUSH_WORKER_SECRET = process.env.PUSH_WORKER_SECRET || '';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PUSH_ENABLED = Boolean(PUSH_WORKER_URL && PUSH_WORKER_SECRET && VAPID_PUBLIC_KEY);
const pushHits = new Map();

async function pushWorker(method, pathname, body) {
  const res = await fetch(PUSH_WORKER_URL + pathname, {
    method,
    headers: { Authorization: `Bearer ${PUSH_WORKER_SECRET}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function pushSubscriptionId(endpoint) {
  return crypto.createHash('sha256').update(endpoint).digest('hex');
}

// Signed-in user and push endpoint for the /api/push/* calls.
async function pushRequest(req, res) {
  if (!PUSH_ENABLED) { json(res, 503, { error: 'Reminders when the app is closed are not set up on this server.' }); return null; }
  let body;
  try { body = await readBody(req); } catch { json(res, 400, { error: 'Invalid request.' }); return null; }
  const user = await requireFirebaseUser(req, res);
  if (!user) return null;
  const endpoint = String(body.endpoint || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1024) { json(res, 400, { error: 'A push endpoint is required.' }); return null; }
  const now = Date.now();
  const recent = (pushHits.get(user.uid) || []).filter(t => now - t < 10 * 60000);
  if (recent.length >= 30) { json(res, 429, { error: 'Too many changes. Try again in a few minutes.' }); return null; }
  recent.push(now);
  pushHits.set(user.uid, recent);
  if (pushHits.size > 5000) pushHits.clear();
  return { user, body, id: pushSubscriptionId(endpoint), endpoint };
}

// Pass the Worker's answer on to the app.
function relayPush(res, result) {
  return json(res, result.ok ? 200 : result.status === 400 ? 400 : 502, result.ok ? { ok: true } : { error: result.data.error || 'The reminder service did not answer.' });
}

async function handlePushSubscribe(req, res) {
  const r = await pushRequest(req, res);
  if (!r) return;
  try {
    return relayPush(res, await pushWorker('PUT', `/subscriptions/${r.id}`, { uid: r.user.uid, endpoint: r.endpoint, tz: r.body.tz, doses: r.body.doses }));
  } catch (e) {
    console.error('Push subscribe failed:', e && e.message);
    return json(res, 502, { error: 'The reminder service did not answer.' });
  }
}

async function handlePushUnsubscribe(req, res) {
  const r = await pushRequest(req, res);
  if (!r) return;
  try {
    return relayPush(res, await pushWorker('DELETE', `/subscriptions/${r.id}`));
  } catch (e) {
    return json(res, 502, { error: 'The reminder service did not answer.' });
  }
}

async function handlePushTest(req, res) {
  const r = await pushRequest(req, res);
  if (!r) return;
  try {
    return relayPush(res, await pushWorker('POST', `/subscriptions/${r.id}/test`));
  } catch (e) {
    return json(res, 502, { error: 'The reminder service did not answer.' });
  }
}

function createRecordShareToken() {
  return base64url(
    crypto.randomBytes(32)
  );
}

function escapeHtmlServer(value) {
  return String(value ?? '')
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#39;'
    );
}

function recordSharePage(token) {
  const safeToken =
    JSON.stringify(
      String(token || '')
    );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Shared health record · SwasthID</title>

<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600&display=swap" rel="stylesheet">
<style>
/* Same tokens as assets/app.css: 4 pt spacing, Lexend, 8/12 px radii. */
:root{--bg:#E6F0F3;--surface:#F7FBFC;--surface-2:#EEF6F8;--border:#D3E0E5;--text:#0F1E26;--text-2:#3E525C;--text-3:#556A72;--brand:#05668D;--brand-soft:#DDEEF4;--brand-text:#04506F;--danger:#B42318}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:400 14px/20px "Lexend",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:880px;margin:0 auto;padding:32px 16px 64px}
.top{margin-bottom:24px}
.brand{display:flex;align-items:center;gap:8px;font-size:16px;line-height:24px;font-weight:600;color:var(--text);margin-bottom:24px}
.brand::before{content:"";width:28px;height:28px;border-radius:8px;background:var(--brand) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M16 9v14M9 16h14' stroke='white' stroke-width='3.2' stroke-linecap='round'/%3E%3C/svg%3E") center/100% no-repeat}
.title{font-size:24px;line-height:32px;font-weight:600;letter-spacing:-.01em;margin:0}
.sub{color:var(--text-2);margin-top:4px}
.notice{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--brand-soft);border-radius:12px;padding:12px 16px;margin-bottom:24px;color:var(--text)}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;min-width:0}
.card.full{grid-column:1/-1}
.card h2{font-size:16px;line-height:24px;font-weight:600;margin:0 0 16px}
.kv{display:grid;grid-template-columns:160px minmax(0,1fr);gap:8px 16px}
.k{color:var(--text-3)}
.v{font-weight:500;overflow-wrap:anywhere}
.item{padding:12px 0;border-top:1px solid var(--border)}
.item:first-child{border-top:0;padding-top:0}
.item strong{display:block;font-weight:600}
.small{font-size:12px;line-height:16px;color:var(--text-3);margin-top:4px}
.status{text-align:center;padding:48px 16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;color:var(--text-2)}
.expired{color:var(--danger);font-weight:600}
.footer{margin-top:24px;color:var(--text-3);font-size:12px;line-height:16px;text-align:center}
.badge{display:inline-flex;align-items:center;height:24px;padding:0 8px;border-radius:999px;background:var(--surface);color:var(--brand-text);font-size:12px;font-weight:600}
@media(max-width:680px){.grid{grid-template-columns:1fr}.card.full{grid-column:auto}.card{padding:16px}.kv{grid-template-columns:1fr;gap:0}.k{margin-top:8px}}
</style>
</head>

<body>

<div class="wrap">

<div class="top">
<div class="brand">SwasthID</div>
<h1 class="title">Shared health record</h1>
<div class="sub">Read-only access shared by the patient for a healthcare professional.</div>
</div>
<div id="app">
<div class="status">
Loading the shared health record…
</div>
</div>

<div class="footer">
SwasthID is an independent personal health record, not a hospital service.
Please verify this information with the patient and their original clinical records.
</div>

</div>

<script>

const token=${safeToken};

function esc(v){
  return String(v??'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;')
}

function val(
  v,
  f='Not provided'
){
  const s=
    String(v??'').trim();

  return s || f
}

function date(v){
  if(!v)
    return 'Date unavailable';

  const d=
    new Date(v);

  return Number.isNaN(
    d.getTime()
  )
    ? esc(v)
    : d.toLocaleDateString()
}

function arr(v){
  return Array.isArray(v)
    ? v
    : []
}

function render(b){

  const p=
    b.patient || {};

  const v=
    b.vitals || {};

  const l=
    b.lifestyle || {};

  const ec=
    b.emergencyContact || {};

  const conditions=
    arr(b.conditions);

  const meds=
    arr(b.medications);

  const encounters=
    arr(b.encounters);

  const reports=
    arr(b.diagnosticReports);

  const expires=
    new Date(
      b.expiresAt ||
      Date.now()
    );

  document.getElementById(
    'app'
  ).innerHTML=

  '<div class="notice">'+
  '<span class="badge">Read only</span>'+
  ' Shared temporarily by the patient. '+
  'Access expires <strong>'+
  esc(
    expires.toLocaleString()
  )+
  '</strong>.</div>'+

  '<div class="grid">'+

  '<section class="card full">'+
  '<h2>Patient</h2>'+
  '<div class="kv">'+

  '<div class="k">Name</div>'+
  '<div class="v">'+
  esc(val(p.name))+
  '</div>'+

  '<div class="k">Date of birth</div>'+
  '<div class="v">'+
  esc(val(p.birthDate))+
  '</div>'+

  '<div class="k">Blood group</div>'+
  '<div class="v">'+
  esc(val(p.bloodGroup))+
  '</div>'+

  '<div class="k">Contact</div>'+
  '<div class="v">'+
  esc(
    val(
      p.telecom &&
      p.telecom[0] &&
      p.telecom[0].value
    )
  )+
  '</div>'+

  '</div>'+
  '</section>'+

  '<section class="card">'+
  '<h2>Vitals & lifestyle</h2>'+
  '<div class="kv">'+

  '<div class="k">Height</div>'+
  '<div class="v">'+
  esc(val(v.height))+
  '</div>'+

  '<div class="k">Weight</div>'+
  '<div class="v">'+
  esc(val(v.weight))+
  '</div>'+

  '<div class="k">BMI</div>'+
  '<div class="v">'+
  esc(val(v.bmi))+
  '</div>'+

  '<div class="k">Smoking</div>'+
  '<div class="v">'+
  esc(val(l.smoking))+
  '</div>'+

  '<div class="k">Alcohol</div>'+
  '<div class="v">'+
  esc(val(l.alcohol))+
  '</div>'+

  '</div>'+
  '</section>'+

  '<section class="card">'+
  '<h2>Emergency contact</h2>'+
  '<div class="kv">'+

  '<div class="k">Name</div>'+
  '<div class="v">'+
  esc(val(ec.name))+
  '</div>'+

  '<div class="k">Relation</div>'+
  '<div class="v">'+
  esc(val(ec.relation))+
  '</div>'+

  '<div class="k">Phone</div>'+
  '<div class="v">'+
  esc(val(ec.phone))+
  '</div>'+

  '</div>'+
  '</section>'+

  '<section class="card">'+
  '<h2>Allergies</h2>'+

  (
    b.allergies
      ? '<div class="item"><strong>Drug allergies</strong><div class="small">'+
        esc(arr(b.allergies.drug).join(', ') || 'No known drug allergies')+
        '</div></div>'+
        '<div class="item"><strong>Other allergies</strong><div class="small">'+
        esc(arr(b.allergies.other).join(', ') || 'None recorded')+
        '</div></div>'
      : '<div class="small">Not included in this share</div>'
  )+

  '</section>'+

  '<section class="card">'+
  '<h2>Medical conditions</h2>'+

  (
    conditions.length

    ? conditions.map(
        c =>

        '<div class="item">'+

        '<strong>'+
        esc(
          val(
            c.code &&
            c.code.text
          )
        )+
        '</strong>'+

        '<div class="small">'+
        esc(
          val(
            c.clinicalStatus &&
            c.clinicalStatus.text,
            'Status not provided'
          )
        )+

        (
          c.onsetYear
            ? ' · '+
              esc(c.onsetYear)
            : ''
        )+

        (
          c.note
            ? ' · '+
              esc(c.note)
            : ''
        )+

        '</div>'+

        '</div>'
      ).join('')

    : '<div class="small">None recorded</div>'
  )+

  '</section>'+

  '<section class="card">'+
  '<h2>Current medications</h2>'+

  (
    meds.length

    ? meds.map(
        m =>

        '<div class="item">'+

        '<strong>'+
        esc(
          val(
            m.medication &&
            m.medication.text
          )
        )+
        '</strong>'+

        '<div class="small">'+

        esc(
          val(
            m.dose &&
            m.dose.text,
            'Dose not provided'
          )
        )+

        ' · '+

        esc(
          val(
            m.frequency &&
            m.frequency.text,
            'Frequency not provided'
          )
        )+

        (
          m.instructions
            ? ' · '+
              esc(m.instructions)
            : ''
        )+

        '</div>'+

        '</div>'
      ).join('')

    : '<div class="small">None recorded</div>'
  )+

  '</section>'+

  '<section class="card full">'+
  '<h2>Recent visits</h2>'+

  (
    encounters.length

    ? encounters
      .slice(0,12)
      .map(
        e =>

        '<div class="item">'+

        '<strong>'+
        esc(date(e.date))+
        '</strong>'+

        '<div class="small">'+

        esc(
          val(
            e.provider,
            'Provider not provided'
          )
        )+

        ' · '+

        esc(
          val(
            e.specialty,
            'Specialty not provided'
          )
        )+

        ' · '+

        esc(
          val(
            e.facility,
            'Facility not provided'
          )
        )+

        '</div>'+

        '</div>'
      ).join('')

    : '<div class="small">None recorded</div>'
  )+

  '</section>'+

  '<section class="card full">'+
  '<h2>Diagnostic reports</h2>'+

  (
    reports.length

    ? reports
      .slice(0,15)
      .map(
        r =>

        '<div class="item">'+

        '<strong>'+
        esc(date(r.date))+
        ' · '+
        esc(
          val(
            r.code &&
            r.code.text
          )
        )+
        '</strong>'+

        '<div class="small">'+
        esc(
          val(
            r.result &&
            r.result.text,
            'Result not provided'
          )
        )+
        '</div>'+

        '</div>'
      ).join('')

    : '<div class="small">None recorded</div>'
  )+

  '</section>'+

  '</div>';
}

fetch(
  '/api/record-share/view?token='+
  encodeURIComponent(token),
  {
    headers:{
      Accept:
        'application/json'
    },
    cache:
      'no-store'
  }
)

.then(
  async r => {

    const body=
      await r.json()
      .catch(
        () => ({})
      );

    if(!r.ok){
      throw new Error(
        body.error ||
        'This sharing link is invalid or expired.'
      );
    }

    return body;
  }
)

.then(
  body => {

    if(!body.payload){
      throw new Error(
        'Shared record is unavailable.'
      );
    }

    render(
      body.payload
    );
  }
)

.catch(
  err => {

    document.getElementById(
      'app'
    ).innerHTML=

    '<div class="status">'+

    '<div class="expired">'+
    'Shared record unavailable'+
    '</div>'+

    '<div style="margin-top:7px;color:#65736c;font-size:13px">'+
    esc(err.message)+
    '</div>'+

    '</div>';
  }
);

</script>

</body>
</html>`;
}

async function handleRecordShareCreate(req, res) {
  const user = await requireFirebaseUser(req, res);
  if (!user) return;

  const body = await readBody(req);
  const record = body && body.record;

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return json(res, 400, { error: 'A valid health record is required.' });
  }

  const requestedHours = Number(body.expiresInHours);
  const expiresInHours = Number.isFinite(requestedHours)
    ? Math.min(24, Math.max(1, requestedHours))
    : 24;
  const expiresAt = Date.now() + expiresInHours * 60 * 60 * 1000;

  // Stored as a JSON string: Firestore rejects nested arrays, which records can contain.
  const serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_SHARE_BYTES) {
    return json(res, 413, {
      error: 'Health record is too large to create a temporary share link.'
    });
  }

  const token = createRecordShareToken();

  await recordShareStore.set(hashToken(token), {
    uid: user.uid,
    record: serialized,
    expiresAt,
    createdAt: Date.now(),
    accesses: [],
    revoked: false
  });

  const origin = getRequestOrigin(req);

  return json(res, 200, {
    shareId: token,
    url: `${origin}/record-share?token=${encodeURIComponent(token)}`,
    expiresAt,
    expiresInHours,
    readOnly: true
  });
}

async function handleRecordShareView(req, res, url) {
  const token = String(url.searchParams.get('token') || '').trim();

  if (!token) {
    return json(res, 400, { error: 'Missing share token.' });
  }

  const id = hashToken(token);
  const share = await recordShareStore.get(id);

  if (!share) {
    return json(res, 410, { error: 'This doctor sharing link is invalid or has expired.' });
  }

  if (share.revoked) {
    return json(res, 410, { error: 'This doctor sharing link has been revoked.' });
  }

  if (Date.now() >= share.expiresAt) {
    await recordShareStore.delete(id);
    return json(res, 410, { error: 'This doctor sharing link has expired.' });
  }

  await recordShareStore.update(id, {
    accesses: appendAccess(share.accesses, {
      timestamp: Date.now(),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300)
    })
  });

  return json(res, 200, {
    payload: {
      ...JSON.parse(share.record),
      expiresAt: share.expiresAt,
      readOnly: true
    }
  });
}

async function findOwnedShare(req, res, shareId) {
  const user = await requireFirebaseUser(req, res);
  if (!user) return null;

  if (!shareId) {
    json(res, 400, { error: 'shareId is required.' });
    return null;
  }

  const id = hashToken(shareId);
  const share = await recordShareStore.get(id);

  if (!share || Date.now() >= share.expiresAt) {
    json(res, 404, { error: 'Share link not found or already expired.' });
    return null;
  }

  if (share.uid !== user.uid) {
    json(res, 403, { error: 'You are not allowed to manage this share.' });
    return null;
  }

  return { id, share };
}

async function handleRecordShareRevoke(req, res) {
  // Read the body before awaiting auth so the request stream is not missed.
  const body = await readBody(req);
  const shareId = String(body.shareId || '').trim();

  const found = await findOwnedShare(req, res, shareId);
  if (!found) return;

  await recordShareStore.update(found.id, { revoked: true, revokedAt: Date.now() });

  return json(res, 200, { ok: true, revoked: true, shareId });
}

async function handleRecordShareAccessLog(req, res, url) {
  const shareId = String(url.searchParams.get('shareId') || '').trim();

  const found = await findOwnedShare(req, res, shareId);
  if (!found) return;

  const accesses = found.share.accesses || [];

  return json(res, 200, {
    shareId,
    createdAt: found.share.createdAt,
    expiresAt: found.share.expiresAt,
    revoked: Boolean(found.share.revoked),
    accessCount: accesses.length,
    accesses
  });
}

async function handleAccountDelete(
  req,
  res
) {
  const user =
    await requireFirebaseUser(
      req,
      res
    );

  if (!user) return;

  if (!firebaseAdmin) {
    return json(res, 503, {
      error:
        'Firebase Admin is not configured.'
    });
  }

  try {
    const db =
      firebaseAdmin.firestore();

    // Removes the user document and its per-item entries subcollection.
    await db.recursiveDelete(
      db
        .collection('users')
        .doc(user.uid)
    );

    const collectionsToDelete = [
      'healthRecords',
      'prescriptions',
      'medications',
      'emergencyProfiles'
    ];

    await recordShareStore.deleteWhere(
      'uid',
      user.uid
    );

    // Stop dose-reminder pushes to every browser of this account.
    if (PUSH_ENABLED) {
      const removed = await pushWorker('DELETE', `/users/${encodeURIComponent(user.uid)}`).catch(e => e);
      if (removed instanceof Error || !removed.ok) console.warn('Could not remove push reminders for a deleted account.');
    }

    for (
      const collectionName of
      collectionsToDelete
    ) {
      const snapshot =
        await db
          .collection(
            collectionName
          )
          .where(
            'uid',
            '==',
            user.uid
          )
          .get();

      if (
        snapshot.empty
      ) {
        continue;
      }

      const batch =
        db.batch();

      snapshot.docs.forEach(
        doc => {
          batch.delete(
            doc.ref
          );
        }
      );

      await batch.commit();
    }

    await firebaseAdmin
      .auth()
      .deleteUser(
        user.uid
      );

    return json(res, 200, {
      ok: true,
      deleted: true,
      uid: user.uid
    });

  } catch (e) {

    console.error(
      'Account deletion failed:',
      e
    );

    return json(res, 500, {
      error:
        'Account deletion failed.',
      detail:
        e.message
    });
  }
}

const server =
  http.createServer(
    async (req, res) => {

      try {

        if (
          req.method ===
          'OPTIONS'
        ) {
          res.writeHead(
            204,
            corsHeaders()
          );

          return res.end();
        }

        const url =
          new URL(
            req.url,
            `http://${
              req.headers.host ||
              'localhost'
            }`
          );

        if (
          req.method === 'GET' &&
          url.pathname ===
            '/health'
        ) {
          return json(
            res,
            200,
            {
              ok: true,
              service:
                'swasthid-render-server',

              firebaseAdmin:
                Boolean(
                  firebaseAdmin
                ),

              riskApi:
                Boolean(
                  RISK_API_URL
                ),

              drugSetu:
                Boolean(
                  DRUGSETU_API_KEY
                ),

              emergency:
                Boolean(
                  EMERGENCY_SECRET
                ),

              // Which build is running (Render sets RENDER_GIT_COMMIT).
              version:
                String(process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7),

              nearby: true,

              accountEmails: mail.configured(),

              pushReminders: PUSH_ENABLED
            }
          );
        }

        if (req.method === 'GET' && url.pathname === '/api/push/config') {
          return json(res, 200, { enabled: PUSH_ENABLED, publicKey: PUSH_ENABLED ? VAPID_PUBLIC_KEY : '' });
        }

        if (req.method === 'POST' && url.pathname === '/api/push/subscribe') {
          return await handlePushSubscribe(req, res);
        }

        if (req.method === 'POST' && url.pathname === '/api/push/unsubscribe') {
          return await handlePushUnsubscribe(req, res);
        }

        if (req.method === 'POST' && url.pathname === '/api/push/test') {
          return await handlePushTest(req, res);
        }

        if (req.method === 'POST' && url.pathname === '/api/auth/password-reset') {
          return await handlePasswordResetEmail(req, res);
        }

        if (req.method === 'POST' && url.pathname === '/api/auth/send-verification') {
          return await handleVerificationEmail(req, res);
        }

        // Where the links in account emails land.
        if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/auth/action') {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'X-Robots-Tag': 'noindex, nofollow'
          });
          if (req.method === 'HEAD') return res.end();
          return fs.createReadStream(path.join(ROOT, 'auth-action.html')).pipe(res);
        }

        if (
          req.method === 'GET' &&
          url.pathname === '/api/nearby'
        ) {
          return await handleNearby(req, res, url);
        }

        if (
          req.method === 'GET' &&
          url.pathname ===
            '/api/medicines/search'
        ) {
          return await handleMedicine(
            req,
            res,
            url
          );
        }

        if (
          req.method === 'POST' &&
          url.pathname ===
            '/api/risk/prevent'
        ) {
          return await handleRisk(
            req,
            res
          );
        }

        if (
          req.method === 'POST' &&
          url.pathname ===
            '/api/emergency/create'
        ) {
          return await handleEmergencyCreate(
            req,
            res
          );
        }

        if (
          req.method === 'GET' &&
          url.pathname ===
            '/api/emergency/view'
        ) {
          return await handleEmergencyView(
            req,
            res,
            url
          );
        }

        if (
          req.method === 'POST' &&
          url.pathname ===
            '/api/emergency/revoke'
        ) {
          return await handleEmergencyRevoke(
            req,
            res
          );
        }

        if (
          req.method === 'GET' &&
          url.pathname ===
            '/api/emergency/activity'
        ) {
          return await handleEmergencyActivity(
            req,
            res,
            url
          );
        }

        if (
          req.method === 'POST' &&
          url.pathname ===
            '/api/record-share/create'
        ) {
          return await handleRecordShareCreate(
            req,
            res
          );
        }

        if (
          req.method === 'GET' &&
          url.pathname ===
            '/api/record-share/view'
        ) {
          return await handleRecordShareView(
            req,
            res,
            url
          );
        }

        if (
          req.method === 'POST' &&
          url.pathname ===
            '/api/record-share/revoke'
        ) {
          return await handleRecordShareRevoke(
            req,
            res
          );
        }

        if (
          req.method === 'GET' &&
          url.pathname ===
            '/api/record-share/access-log'
        ) {
          return await handleRecordShareAccessLog(
            req,
            res,
            url
          );
        }

        if (
          (
            req.method === 'POST' ||
            req.method === 'DELETE'
          ) &&
          url.pathname ===
            '/api/account/delete'
        ) {
          return await handleAccountDelete(
            req,
            res
          );
        }

        if (
          req.method === 'GET' &&
          url.pathname ===
            '/record-share'
        ) {

          const token =
            String(
              url.searchParams.get(
                'token'
              ) || ''
            ).trim();

          if (!token) {
            return html(
              res,
              400,
              '<h1>Missing share token</h1>' +
              '<p>This doctor sharing link is incomplete.</p>'
            );
          }

          return html(
            res,
            200,
            recordSharePage(
              token
            )
          );
        }

        if (
          (
            req.method === 'GET' ||
            req.method === 'HEAD'
          ) &&
          (
            url.pathname === '/' ||
            url.pathname ===
              '/index.html'
          )
        ) {
          res.writeHead(
            200,
            {
              'Content-Type':
                'text/html; charset=utf-8',

              'Cache-Control':
                'no-cache'
            }
          );

          if (req.method === 'HEAD') {
            return res.end();
          }

          // Social previews need absolute URLs; fill in this deployment's origin.
          const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
          const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
          const origin = PUBLIC_BASE_URL || (/^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `${proto === 'https' ? 'https' : 'http'}://${host}` : '');
          return res.end(
            fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replaceAll('__ORIGIN__', origin)
          );
        }

        // Static assets (stylesheets, scripts, icons, social image). Only known
        // file types inside ./assets are served.
        if (
          (req.method === 'GET' || req.method === 'HEAD') &&
          url.pathname.startsWith('/assets/')
        ) {
          const types = {
            '.css': 'text/css; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.webmanifest': 'application/manifest+json'
          };
          const assetsDir = path.join(ROOT, 'assets');
          const file = path.normalize(path.join(assetsDir, decodeURIComponent(url.pathname.slice('/assets/'.length))));
          const type = types[path.extname(file).toLowerCase()];
          if (!type || !file.startsWith(assetsDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            return json(res, 404, { error: 'Not found' });
          }
          res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
          if (req.method === 'HEAD') return res.end();
          return fs.createReadStream(file).pipe(res);
        }

        if (
          req.method === 'GET' &&
          url.pathname ===
            '/sw.js'
        ) {
          res.writeHead(
            200,
            {
              'Content-Type':
                'application/javascript; charset=utf-8',

              'Cache-Control':
                'no-cache'
            }
          );

          return fs
            .createReadStream(
              path.join(
                ROOT,
                'sw.js'
              )
            )
            .pipe(res);
        }

        if (
          req.method === 'GET' &&
          url.pathname ===
            '/firebase-config.js'
        ) {

          res.writeHead(
            200,
            {
              'Content-Type':
                'application/javascript; charset=utf-8',

              'Cache-Control':
                'no-store',

              ...corsHeaders()
            }
          );

          // DEMO_MODE=1: run without Firebase; the app keeps data in the browser.
          if (DEMO_MODE) return res.end('window.SWASTH_FIREBASE_CONFIG = {};\n');
          // Local Firebase emulators (tests and local development only).
          if (USING_EMULATORS) {
            return res.end(`window.SWASTH_FIREBASE_CONFIG = ${JSON.stringify({ apiKey: 'demo-key', authDomain: `${FIREBASE_PROJECT_ID}.firebaseapp.com`, projectId: FIREBASE_PROJECT_ID, appId: 'demo-app' })};\n` +
              `window.SWASTH_EMULATORS = ${JSON.stringify({ auth: `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, firestore: process.env.FIRESTORE_EMULATOR_HOST })};\n`);
          }

          return fs
            .createReadStream(
              path.join(
                ROOT,
                'firebase-config.js'
              )
            )
            .pipe(res);
        }

        if (
          req.method === 'GET' &&
          url.pathname ===
            '/firestore.rules'
        ) {

          res.writeHead(
            200,
            {
              'Content-Type':
                'text/plain; charset=utf-8',

              'Cache-Control':
                'no-store',

              ...corsHeaders()
            }
          );

          return fs
            .createReadStream(
              path.join(
                ROOT,
                'firestore.rules'
              )
            )
            .pipe(res);
        }

        return json(
          res,
          404,
          {
            error:
              'Not found'
          }
        );

      } catch (e) {

        // From readBody: the client sent a bad or oversized body.
        if (e && (e.message === 'Invalid JSON' || e.message === 'Request too large')) {
          return json(res, 400, { error: e.message });
        }

        console.error(
          'Unhandled server error:',
          e
        );

        return json(
          res,
          500,
          {
            error:
              'Server error'
          }
        );
      }
    }
  );

server.listen(
  PORT,
  HOST,
  () => {
    console.log(
      `SwasthID server listening on ${HOST}:${PORT}`
    );
  }
);
