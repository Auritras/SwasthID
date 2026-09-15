const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';

const DRUGSETU_API_KEY = process.env.DRUGSETU_API_KEY || '';
const RISK_API_URL = (process.env.RISK_API_URL || '').replace(/\/$/, '');
const EMERGENCY_SECRET = process.env.EMERGENCY_SECRET || '';

const ROOT = __dirname;

const recordShares = new Map();
const MAX_RECORD_SHARE_BYTES = 180000;

if (!EMERGENCY_SECRET) {
  console.warn(
    'WARNING: EMERGENCY_SECRET is not set. Emergency token creation will be disabled until configured.'
  );
}

function json(res, status, body) {
  const out = JSON.stringify(body);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });

  res.end(out);
}

function html(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive'
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
    String(str).replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  );
}

function secretKey() {
  return crypto
    .createHash('sha256')
    .update(EMERGENCY_SECRET)
    .digest();
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;

      if (body.length > 200000) {
        req.destroy();
        reject(new Error('Request too large'));
      }
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

function normalizeMedicine(m) {
  return {
    id: m.id || '',
    name: m.brand_name || m.name || m.product_name || '',
    salt: m.salt || m.composition || '',
    strength: m.strength || '',
    form: m.form || '',
    brand: m.brand_name || m.brand || '',
    company: m.company || m.manufacturer || '',
    pack: m.pack_size || m.pack || '',
    mrp: Number(m.mrp ?? m.price ?? 0) || 0,
    gst: Number(m.gst_pct ?? m.gst ?? 0) || 0,
    prescriptionRequired: Boolean(
      m.prescription_required ?? m.rx ?? false
    ),
    cdscoAligned: Boolean(
      m.cdsco_aligned ?? false
    )
  };
}

async function handleMedicine(req, res, url) {
  if (!DRUGSETU_API_KEY) {
    return json(res, 503, {
      error: 'Medicine API is not configured on the server.'
    });
  }

  const q = String(
    url.searchParams.get('q') || ''
  ).trim();

  const type = String(
    url.searchParams.get('type') || 'brand'
  );

  const limit = Math.min(
    30,
    Math.max(
      1,
      Number(
        url.searchParams.get('limit') || 10
      )
    )
  );

  if (q.length < 2) {
    return json(res, 400, {
      error: 'Search query must contain at least 2 characters.'
    });
  }

  const upstream = new URL(
    'https://api.drugsetu.in/v1/medicines/search'
  );

  upstream.searchParams.set('q', q);
  upstream.searchParams.set('type', type);
  upstream.searchParams.set('limit', String(limit));

  const response = await fetch(upstream, {
    headers: {
      'X-API-Key': DRUGSETU_API_KEY,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });

  const raw = await response.text();

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
    return json(res, response.status, {
      error: 'DrugSetu request failed',
      details: data
    });
  }

  const rows = Array.isArray(data)
    ? data
    : (
      Array.isArray(data.medicines)
        ? data.medicines
        : Array.isArray(data.results)
          ? data.results
          : Array.isArray(data.data)
            ? data.data
            : Array.isArray(data.products)
              ? data.products
              : []
    );

  const medicines = rows
    .map(normalizeMedicine)
    .filter(m => m.name);

  return json(res, 200, {
    status: data.status || 'success',
    total: Number(
      data.total ?? medicines.length
    ),
    medicines,
    source: 'DrugSetu',
    disclaimer:
      'Information sourced from DrugSetu is for informational purposes only. DrugSetu standardizes data but does not guarantee accuracy. Consult healthcare professionals for medical decisions.'
  });
}

async function handleRisk(req, res) {
  if (!RISK_API_URL) {
    return json(res, 503, {
      error: 'Risk API is not configured on the server.'
    });
  }

  const body = await readBody(req);

  const response = await fetch(
    RISK_API_URL + '/prevent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      error: 'Invalid response from risk service'
    };
  }

  return json(
    res,
    response.status,
    data
  );
}

async function handleEmergencyCreate(req, res) {
  if (!EMERGENCY_SECRET) {
    return json(res, 503, {
      error: 'Emergency token service is not configured.'
    });
  }

  const p = await readBody(req);

  const payload = {
    v: 4,
    exp: Date.now() + 24 * 60 * 60 * 1000,

    n: String(
      p.n || 'Unknown patient'
    ).slice(0, 120),

    bg: String(
      p.bg || 'Not provided'
    ).slice(0, 30),

    da: String(
      p.da || 'No known drug allergies'
    ).slice(0, 500),

    oa: String(
      p.oa || 'None recorded'
    ).slice(0, 500),

    c: Array.isArray(p.c)
      ? p.c
          .slice(0, 6)
          .map(x => String(x).slice(0, 100))
      : [],

    m: Array.isArray(p.m)
      ? p.m
          .slice(0, 5)
          .map(x => String(x).slice(0, 140))
      : [],

    ec: Array.isArray(p.ec)
      ? p.ec
          .slice(0, 3)
          .map(x => String(x).slice(0, 100))
      : []
  };

  const token = encryptEmergency(payload);

  const origin =
    `${req.headers['x-forwarded-proto'] || 'https'}://` +
    `${req.headers['x-forwarded-host'] || req.headers.host}`;

  return json(res, 200, {
    url:
      `${origin}/?emergency=` +
      encodeURIComponent(token),

    expiresAt: payload.exp
  });
}

async function handleEmergencyView(req, res, url) {
  try {
    const token =
      url.searchParams.get('token');

    if (!token) {
      return json(res, 400, {
        error: 'Missing token'
      });
    }

    const payload =
      decryptEmergency(token);

    if (
      !payload.exp ||
      Date.now() > Number(payload.exp)
    ) {
      return json(res, 410, {
        error: 'Emergency token expired'
      });
    }

    return json(res, 200, {
      payload
    });

  } catch (e) {
    return json(res, 410, {
      error: 'Invalid or expired emergency token'
    });
  }
}

function cleanupRecordShares() {
  const now = Date.now();

  for (const [token, share] of recordShares) {
    if (
      !share ||
      now >= share.expiresAt
    ) {
      recordShares.delete(token);
    }
  }
}

setInterval(
  cleanupRecordShares,
  10 * 60 * 1000
).unref();

function getRequestOrigin(req) {
  const proto =
    String(
      req.headers['x-forwarded-proto'] ||
      'https'
    )
      .split(',')[0]
      .trim();

  const host =
    String(
      req.headers['x-forwarded-host'] ||
      req.headers.host ||
      ''
    )
      .split(',')[0]
      .trim();

  return `${proto}://${host}`;
}

function createRecordShareToken() {
  return base64url(
    crypto.randomBytes(32)
  );
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function listHtml(
  items,
  emptyText = 'None recorded'
) {
  const arr =
    Array.isArray(items)
      ? items
      : [];

  if (!arr.length) {
    return `<p class="muted">${escapeHtml(
      emptyText
    )}</p>`;
  }

  return `
    <ul>
      ${arr
        .map(x =>
          `<li>${escapeHtml(
            typeof x === 'object'
              ? JSON.stringify(x)
              : x
          )}</li>`
        )
        .join('')}
    </ul>
  `;
}

function recordSharePage(token) {
  return `<!doctype html>
<html lang="en">

<head>
<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>SwasthID — Shared Health Record</title>

<style>

body{
  font-family:
    Inter,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;

  background:#f5f7fb;
  color:#172033;
  margin:0;
  padding:24px;
}

.wrap{
  max-width:900px;
  margin:0 auto;
}

header{
  background:#0b6b57;
  color:#fff;
  border-radius:18px;
  padding:24px;
  margin-bottom:18px;
}

h1{
  margin:0 0 6px;
  font-size:28px;
}

h2{
  font-size:18px;
  margin:0 0 12px;
}

.card{
  background:#fff;
  border:1px solid #e5e9ef;
  border-radius:16px;
  padding:18px;
  margin:14px 0;
  box-shadow:
    0 4px 18px rgba(20,30,50,.05);
}

.grid{
  display:grid;
  grid-template-columns:
    repeat(2,minmax(0,1fr));
  gap:14px;
}

.item{
  padding:12px;
  background:#f8fafc;
  border-radius:12px;
}

.label{
  font-size:12px;
  color:#667085;
  text-transform:uppercase;
  letter-spacing:.06em;
}

.value{
  font-size:15px;
  margin-top:4px;
  white-space:pre-wrap;
  overflow-wrap:anywhere;
}

.muted{
  color:#667085;
}

.warning{
  background:#fff8e6;
  border:1px solid #f3d48a;
  color:#6f4d00;
  padding:12px;
  border-radius:12px;
}

.error{
  background:#fff0f0;
  border:1px solid #efb4b4;
  color:#8a1f1f;
  padding:14px;
  border-radius:12px;
}

ul{
  margin:8px 0 0;
  padding-left:20px;
}

li{
  margin:5px 0;
  overflow-wrap:anywhere;
}

@media(max-width:700px){

  body{
    padding:12px;
  }

  .grid{
    grid-template-columns:1fr;
  }

  header{
    padding:18px;
  }

}

</style>
</head>

<body>

<div class="wrap">

<header>

<div
  style="
    font-weight:800;
    letter-spacing:.08em
  "
>
  SWASTHID
</div>

<h1>
  Shared Health Record
</h1>

<div>
  Read-only access for a healthcare professional.
</div>

</header>

<div
  id="status"
  class="card"
>
  Loading shared record…
</div>

<div
  id="record"
  hidden
></div>

</div>

<script>

const token =
  ${JSON.stringify(token)};

function esc(value){

  return String(value ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');

}

function list(items){

  const a =
    Array.isArray(items)
      ? items
      : [];

  if(!a.length){

    return
      '<p class="muted">' +
      'None recorded' +
      '</p>';

  }

  return
    '<ul>' +
    a
      .map(x =>
        '<li>' +
        esc(
          typeof x === 'object'
            ? JSON.stringify(x)
            : x
        ) +
        '</li>'
      )
      .join('') +
    '</ul>';

}

function value(
  obj,
  key,
  fallback='Not provided'
){

  return obj &&
    obj[key] != null &&
    String(obj[key]).trim()
      ? obj[key]
      : fallback;

}

function render(payload){

  const patient =
    payload.patient || {};

  const vitals =
    payload.vitals || {};

  const lifestyle =
    payload.lifestyle || {};

  const emergency =
    payload.emergencyContact || {};

  const record =
    document.getElementById(
      'record'
    );

  record.innerHTML =

    '<div class="card">' +
      '<h2>Patient</h2>' +

      '<div class="grid">' +

        '<div class="item">' +
          '<div class="label">Name</div>' +
          '<div class="value">' +
            esc(value(
              patient,
              'name'
            )) +
          '</div>' +
        '</div>' +

        '<div class="item">' +
          '<div class="label">Date of birth</div>' +
          '<div class="value">' +
            esc(value(
              patient,
              'birthDate'
            )) +
          '</div>' +
        '</div>' +

        '<div class="item">' +
          '<div class="label">Blood group</div>' +
          '<div class="value">' +
            esc(value(
              patient,
              'bloodGroup'
            )) +
          '</div>' +
        '</div>' +

        '<div class="item">' +
          '<div class="label">Email</div>' +
          '<div class="value">' +
            esc(value(
              patient,
              'email'
            )) +
          '</div>' +
        '</div>' +

      '</div>' +
    '</div>' +

    '<div class="card">' +
      '<h2>Vitals & lifestyle</h2>' +

      '<div class="grid">' +

        '<div class="item">' +
          '<div class="label">Height</div>' +
          '<div class="value">' +
            esc(value(
              vitals,
              'height'
            )) +
          '</div>' +
        '</div>' +

        '<div class="item">' +
          '<div class="label">Weight</div>' +
          '<div class="value">' +
            esc(value(
              vitals,
              'weight'
            )) +
          '</div>' +
        '</div>' +

        '<div class="item">' +
          '<div class="label">BMI</div>' +
          '<div class="value">' +
            esc(value(
              vitals,
              'bmi'
            )) +
          '</div>' +
        '</div>' +

        '<div class="item">' +
          '<div class="label">Activity</div>' +
          '<div class="value">' +
            esc(value(
              lifestyle,
              'activity'
            )) +
          '</div>' +
        '</div>' +

      '</div>' +
    '</div>' +

    '<div class="card">' +
      '<h2>Emergency contact</h2>' +
      '<div class="value">' +
        esc(
          JSON.stringify(
            emergency,
            null,
            2
          )
        ) +
      '</div>' +
    '</div>' +

    '<div class="card">' +
      '<h2>Medical conditions</h2>' +
      list(payload.conditions) +
    '</div>' +

    '<div class="card">' +
      '<h2>Current medications</h2>' +
      list(payload.medications) +
    '</div>' +

    '<div class="card">' +
      '<h2>Recent visits</h2>' +
      list(payload.encounters) +
    '</div>' +

    '<div class="card">' +
      '<h2>Diagnostic reports</h2>' +
      list(payload.diagnosticReports) +
    '</div>' +

    '<div class="warning">' +
      'SwasthID is a prototype and is not ' +
      'an official Government of India service. ' +
      'This shared record is read-only and should ' +
      'be verified with the original medical records.' +
    '</div>';

  record.hidden = false;

  document
    .getElementById('status')
    .remove();

}

async function load(){

  try{

    const res =
      await fetch(
        '/api/record-share/view?token=' +
        encodeURIComponent(token),
        {
          headers:{
            'Accept':
              'application/json'
          }
        }
      );

    const data =
      await res.json();

    if(!res.ok){

      throw new Error(
        data.error ||
        'Unable to load shared record.'
      );

    }

    render(
      data.payload || {}
    );

  }catch(err){

    document
      .getElementById('status')
      .innerHTML =
        '<div class="error">' +
        esc(err.message) +
        '</div>';

  }

}

load();

</script>

</body>
</html>`;
}

async function handleRecordShareCreate(
  req,
  res
) {

  cleanupRecordShares();

  const body =
    await readBody(req);

  const record =
    body && body.record;

  if(
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record)
  ){

    return json(res, 400, {
      error:
        'A valid health record is required.'
    });

  }

  const requestedHours =
    Number(
      body.expiresInHours
    );

  const expiresInHours =
    Number.isFinite(requestedHours)
      ? Math.min(
          24,
          Math.max(
            1,
            requestedHours
          )
        )
      : 24;

  const expiresAt =
    Date.now() +
    expiresInHours *
    60 *
    60 *
    1000;

  const serialized =
    JSON.stringify(record);

  if(
    Buffer.byteLength(
      serialized,
      'utf8'
    ) > MAX_RECORD_SHARE_BYTES
  ){

    return json(res, 413, {
      error:
        'Health record is too large to create a temporary share link.'
    });

  }

  const token =
    createRecordShareToken();

  recordShares.set(
    token,
    {
      record,
      expiresAt,
      createdAt: Date.now()
    }
  );

  const origin =
    getRequestOrigin(req);

  return json(res, 200, {

    url:
      `${origin}/record-share?token=` +
      encodeURIComponent(token),

    expiresAt,

    expiresInHours,

    readOnly: true

  });
}

async function handleRecordShareView(
  req,
  res,
  url
) {

  cleanupRecordShares();

  const token =
    String(
      url.searchParams.get('token') ||
      ''
    ).trim();

  if(!token){

    return json(res, 400, {
      error:
        'Missing share token.'
    });

  }

  const share =
    recordShares.get(token);

  if(!share){

    return json(res, 410, {
      error:
        'This doctor sharing link is invalid or has expired.'
    });

  }

  if(
    Date.now() >=
    share.expiresAt
  ){

    recordShares.delete(token);

    return json(res, 410, {
      error:
        'This doctor sharing link has expired.'
    });

  }

  return json(res, 200, {

    payload: {
      ...share.record,
      expiresAt:
        share.expiresAt,
      readOnly: true
    }

  });
}

async function fetchNearbyFromOverpass(
  lat,
  lon
) {

  const query =
`[out:json][timeout:15];
(
  node(around:5000,${lat},${lon})["amenity"~"hospital|clinic|doctors|pharmacy"];
  way(around:5000,${lat},${lon})["amenity"~"hospital|clinic|doctors|pharmacy"];
  relation(around:5000,${lat},${lon})["amenity"~"hospital|clinic|doctors|pharmacy"];
);
out center tags;`;

  const endpoints = [
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter'
  ];

  let lastError;

  for(
    const endpoint of endpoints
  ){

    try{

      const response =
        await fetch(
          endpoint,
          {
            method:'POST',

            headers:{
              'Content-Type':
                'application/x-www-form-urlencoded',

              'Accept':
                'application/json'
            },

            body:
              'data=' +
              encodeURIComponent(query)
          }
        );

      if(!response.ok){

        lastError =
          new Error(
            `Overpass returned HTTP ${response.status}`
          );

        continue;

      }

      const data =
        await response.json();

      const elements =
        Array.isArray(data.elements)
          ? data.elements
          : [];

      return elements
        .map(el => {

          const tags =
            el.tags || {};

          const center =
            el.center || {};

          const itemLat =
            Number(
              el.lat ??
              center.lat
            );

          const itemLon =
            Number(
              el.lon ??
              center.lon
            );

          return {

            id:
              String(
                el.id ?? ''
              ),

            name:
              String(
                tags.name ||
                tags['name:en'] ||
                'Healthcare facility'
              ),

            type:
              String(
                tags.amenity ||
                'healthcare'
              ),

            lat:
              itemLat,

            lon:
              itemLon,

            address:
              String(
                tags['addr:full'] ||
                [
                  tags['addr:housenumber'],
                  tags['addr:street'],
                  tags['addr:city']
                ]
                .filter(Boolean)
                .join(', ')
              ),

            phone:
              String(
                tags.phone ||
                tags['contact:phone'] ||
                ''
              ),

            website:
              String(
                tags.website ||
                tags['contact:website'] ||
                ''
              )

          };

        })
        .filter(
          x =>
            Number.isFinite(x.lat) &&
            Number.isFinite(x.lon)
        );

    }catch(e){

      lastError = e;

    }

  }

  throw (
    lastError ||
    new Error(
      'Nearby healthcare lookup failed.'
    )
  );
}

async function handleNearby(
  req,
  res,
  url
) {

  const lat =
    Number(
      url.searchParams.get('lat')
    );

  const lon =
    Number(
      url.searchParams.get('lon')
    );

  if(
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ){

    return json(res, 400, {
      error:
        'Valid latitude and longitude are required.'
    });

  }

  if(
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ){

    return json(res, 400, {
      error:
        'Latitude or longitude is out of range.'
    });

  }

  try{

    const results =
      await fetchNearbyFromOverpass(
        lat,
        lon
      );

    results.sort(
      (a,b) => {

        const da =
          (a.lat - lat) ** 2 +
          (a.lon - lon) ** 2;

        const db =
          (b.lat - lat) ** 2 +
          (b.lon - lon) ** 2;

        return da - db;

      }
    );

    return json(
      res,
      200,
      results.slice(0,30)
    );

  }catch(e){

    console.error(
      'Nearby healthcare error:',
      e
    );

    return json(res, 502, {
      error:
        'Nearby healthcare lookup failed.'
    });

  }
}

const server =
  http.createServer(
    async (req,res) => {

      try{

        if(req.method === 'OPTIONS'){

          res.writeHead(
            204,
            {
              'Access-Control-Allow-Origin':'*',

              'Access-Control-Allow-Headers':
                'Content-Type,Accept',

              'Access-Control-Allow-Methods':
                'GET,POST,OPTIONS'
            }
          );

          return res.end();

        }

        const url =
          new URL(
            req.url,
            `http://${req.headers.host}`
          );

        if(
          req.method === 'GET' &&
          url.pathname === '/health'
        ){

          return json(
            res,
            200,
            {
              ok:true,
              service:
                'swasthid-render-server'
            }
          );

        }

        if(
          req.method === 'GET' &&
          url.pathname ===
            '/api/medicines/search'
        ){

          return await handleMedicine(
            req,
            res,
            url
          );

        }

        if(
          req.method === 'POST' &&
          url.pathname ===
            '/api/emergency/create'
        ){

          return await handleEmergencyCreate(
            req,
            res
          );

        }

        if(
          req.method === 'GET' &&
          url.pathname ===
            '/api/emergency/view'
        ){

          return await handleEmergencyView(
            req,
            res,
            url
          );

        }

        if(
          req.method === 'POST' &&
          url.pathname ===
            '/api/risk/prevent'
        ){

          return await handleRisk(
            req,
            res
          );

        }

        if(
          req.method === 'POST' &&
          url.pathname ===
            '/api/record-share/create'
        ){

          return await handleRecordShareCreate(
            req,
            res
          );

        }

        if(
          req.method === 'GET' &&
          url.pathname ===
            '/api/record-share/view'
        ){

          return await handleRecordShareView(
            req,
            res,
            url
          );

        }

        if(
          req.method === 'GET' &&
          url.pathname ===
            '/record-share'
        ){

          const token =
            String(
              url.searchParams.get(
                'token'
              ) || ''
            ).trim();

          if(!token){

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
            recordSharePage(token)
          );

        }

        if(
          req.method === 'GET' &&
          url.pathname ===
            '/api/nearby'
        ){

          return await handleNearby(
            req,
            res,
            url
          );

        }

        if(
          req.method === 'GET' &&
          (
            url.pathname === '/' ||
            url.pathname === '/index.html'
          )
        ){

          return fs
            .createReadStream(
              path.join(
                ROOT,
                'index.html'
              )
            )
            .pipe(res);

        }

        if(
          req.method === 'GET' &&
          url.pathname ===
            '/firebase-config.js'
        ){

          res.writeHead(
            200,
            {
              'Content-Type':
                'application/javascript; charset=utf-8',

              'Cache-Control':
                'no-store'
            }
          );

          return fs
            .createReadStream(
              path.join(
                ROOT,
                'firebase-config.js'
              )
            )
            .pipe(res);

        }

        if(
          req.method === 'GET' &&
          url.pathname ===
            '/firestore.rules'
        ){

          res.writeHead(
            200,
            {
              'Content-Type':
                'text/plain; charset=utf-8'
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
            error:'Not found'
          }
        );

      }catch(e){

        console.error(e);

        return json(
          res,
          500,
          {
            error:'Server error'
          }
        );

      }

    }
  );

server.listen(
  PORT,
  HOST,
  () =>
    console.log(
      `SwasthID server listening on ${HOST}:${PORT}`
    )
);
