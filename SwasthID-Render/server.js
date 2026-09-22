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

// Temporary doctor-share records. These are intentionally kept in memory only.
// A Render restart/redeploy clears them, which is acceptable for the prototype.
const recordShares = new Map();
const RECORD_SHARE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RECORD_SHARE_BYTES = 180000;

if (!EMERGENCY_SECRET) console.warn('WARNING: EMERGENCY_SECRET is not set. Emergency token creation will be disabled until configured.');

function json(res, status, body) {
  const out = JSON.stringify(body);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
  res.end(out);
}
function html(res, status, body) {
  res.writeHead(status, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive'});
  res.end(body);
}
function base64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function fromBase64url(str) { return Buffer.from(String(str).replace(/-/g,'+').replace(/_/g,'/'), 'base64'); }
function secretKey() { return crypto.createHash('sha256').update(EMERGENCY_SECRET).digest(); }
function encryptEmergency(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ['v1', base64url(iv), base64url(cipher.getAuthTag()), base64url(encrypted)].join('.');
}
function decryptEmergency(token) {
  const [version, ivPart, tagPart, dataPart] = String(token).split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !dataPart || !EMERGENCY_SECRET) throw new Error('Invalid emergency token');
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), fromBase64url(ivPart));
  decipher.setAuthTag(fromBase64url(tagPart));
  const decrypted = Buffer.concat([decipher.update(fromBase64url(dataPart)), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}
function readBody(req) {
  return new Promise((resolve,reject)=>{
    let body='';
    req.on('data', chunk => { body += chunk; if (body.length > 200000) { req.destroy(); reject(new Error('Request too large')); } });
    req.on('end', ()=>{ try { resolve(body ? JSON.parse(body) : {}); } catch(e){ reject(new Error('Invalid JSON')); } });
    req.on('error',reject);
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
    prescriptionRequired: Boolean(m.prescription_required ?? m.rx ?? false),
    cdscoAligned: Boolean(m.cdsco_aligned ?? false)
  };
}

async function handleMedicine(req,res,url) {
  if (!DRUGSETU_API_KEY) return json(res,503,{error:'Medicine API is not configured on the server.'});
  const q = String(url.searchParams.get('q') || '').trim();
  const type = String(url.searchParams.get('type') || 'brand');
  const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit') || 10)));
  if (q.length < 2) return json(res,400,{error:'Search query must contain at least 2 characters.'});
  const upstream = new URL('https://api.drugsetu.in/v1/medicines/search');
  upstream.searchParams.set('q',q); upstream.searchParams.set('type',type); upstream.searchParams.set('limit',String(limit));
  const response = await fetch(upstream, {headers:{'X-API-Key':DRUGSETU_API_KEY,'Accept':'application/json','Content-Type':'application/json'}});
  const raw = await response.text();
  let data; try { data=JSON.parse(raw); } catch { data={status:'error',raw}; }
  if (!response.ok) return json(res,response.status,{error:'DrugSetu request failed',details:data});
  const rows = Array.isArray(data) ? data : (
    Array.isArray(data.medicines) ? data.medicines :
    Array.isArray(data.results) ? data.results :
    Array.isArray(data.data) ? data.data :
    Array.isArray(data.products) ? data.products : []
  );
  const medicines = rows.map(normalizeMedicine).filter(m => m.name);
  json(res,200,{status:data.status || 'success',total:Number(data.total ?? medicines.length),medicines,source:'DrugSetu',disclaimer:'Information sourced from DrugSetu is for informational purposes only. DrugSetu standardizes data but does not guarantee accuracy. Consult healthcare professionals for medical decisions.'});
}

async function handleRisk(req,res) {
  if (!RISK_API_URL) return json(res,503,{error:'Risk API is not configured on the server.'});
  const body = await readBody(req);
  const response = await fetch(RISK_API_URL + '/prevent', {method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)});
  const text = await response.text();
  let data; try { data=JSON.parse(text); } catch { data={error:'Invalid response from risk service'}; }
  json(res,response.status,data);
}

async function handleEmergencyCreate(req,res) {
  if (!EMERGENCY_SECRET) return json(res,503,{error:'Emergency token service is not configured.'});
  const p = await readBody(req);
  const payload = {
    v: 4,
    exp: Date.now() + 24*60*60*1000,
    n: String(p.n || 'Unknown patient').slice(0,120),
    bg: String(p.bg || 'Not provided').slice(0,30),
    da: String(p.da || 'No known drug allergies').slice(0,500),
    oa: String(p.oa || 'None recorded').slice(0,500),
    c: Array.isArray(p.c) ? p.c.slice(0,6).map(x=>String(x).slice(0,100)) : [],
    m: Array.isArray(p.m) ? p.m.slice(0,5).map(x=>String(x).slice(0,140)) : [],
    ec: Array.isArray(p.ec) ? p.ec.slice(0,3).map(x=>String(x).slice(0,100)) : []
  };
  const token = encryptEmergency(payload);
  const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  json(res,200,{url:`${origin}/?emergency=${encodeURIComponent(token)}`,expiresAt:payload.exp});
}

async function handleEmergencyView(req,res,url) {
  try {
    const token = url.searchParams.get('token');
    if (!token) return json(res,400,{error:'Missing token'});
    const payload = decryptEmergency(token);
    if (!payload.exp || Date.now() > Number(payload.exp)) return json(res,410,{error:'Emergency token expired'});
    json(res,200,{payload});
  } catch (e) { json(res,410,{error:'Invalid or expired emergency token'}); }
}

function cleanupRecordShares() {
  const now = Date.now();
  for (const [token, share] of recordShares) {
    if (!share || now >= share.expiresAt) recordShares.delete(token);
  }
}
setInterval(cleanupRecordShares, 10 * 60 * 1000).unref();

function getRequestOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

function createRecordShareToken() {
  return base64url(crypto.randomBytes(32));
}

function escapeHtmlServer(value) {
  return String(value ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function valueOrFallback(value, fallback='Not provided') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function recordSharePage(token) {
  const safeToken = JSON.stringify(String(token || ''));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>SwasthID — Shared Health Record</title>
<style>
:root{--ink:#1c2b27;--muted:#65736c;--line:#d6e0db;--soft:#f4f8f5;--accent:#2f6956;--accent2:#dff0e8;--danger:#8f2d24}
*{box-sizing:border-box}body{margin:0;background:#f7faf8;color:var(--ink);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.45}
.wrap{max-width:920px;margin:0 auto;padding:28px 18px 50px}.top{background:var(--accent);color:#fff;border-radius:18px;padding:24px 26px;margin-bottom:18px;box-shadow:0 10px 28px rgba(28,43,39,.10)}
.brand{font-weight:800;letter-spacing:.08em;font-size:12px}.title{font-size:28px;font-weight:800;margin:7px 0 5px}.sub{opacity:.88;font-size:13px}.notice{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:18px;color:var(--muted);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:17px;min-width:0}.card.full{grid-column:1/-1}.card h2{font-size:16px;margin:0 0 12px}.kv{display:grid;grid-template-columns:150px minmax(0,1fr);gap:8px 12px;font-size:13px}.k{color:var(--muted);font-weight:700}.v{overflow-wrap:anywhere}.item{padding:11px 0;border-top:1px solid #edf1ef}.item:first-child{border-top:0;padding-top:0}.item strong{display:block;font-size:13px}.small{font-size:12px;color:var(--muted);margin-top:3px}.status{text-align:center;padding:45px 18px;background:#fff;border:1px solid var(--line);border-radius:16px}.expired{color:var(--danger);font-weight:800}
.footer{margin-top:18px;color:var(--muted);font-size:11px;text-align:center}.badge{display:inline-block;padding:4px 8px;border-radius:999px;background:var(--accent2);color:var(--accent);font-size:11px;font-weight:800}
@media(max-width:680px){.grid{grid-template-columns:1fr}.card.full{grid-column:auto}.kv{grid-template-columns:1fr;gap:2px}.k{margin-top:5px}.title{font-size:23px}.top{padding:20px}}
</style>
</head>
<body>
<div class="wrap">
<div class="top"><div class="brand">SWASTHID</div><div class="title">Shared Health Record</div><div class="sub">Read-only access for a healthcare professional</div></div>
<div id="app"><div class="status">Loading the shared health record…</div></div>
<div class="footer">SwasthID is a prototype and is not an official Government of India service. This shared record is informational and should be verified with the patient and original clinical records.</div>
</div>
<script>
const token=${safeToken};
function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function val(v,f='Not provided'){const s=String(v??'').trim();return s||f}
function date(v){if(!v)return 'Date unavailable';const d=new Date(v);return Number.isNaN(d.getTime())?esc(v):d.toLocaleDateString()}
function arr(v){return Array.isArray(v)?v:[]}
function render(b){
 const p=b.patient||{}, v=b.vitals||{}, l=b.lifestyle||{}, ec=b.emergencyContact||{};
 const conditions=arr(b.conditions), meds=arr(b.medications), encounters=arr(b.encounters), reports=arr(b.diagnosticReports);
 const expires=new Date(b.expiresAt||Date.now());
 document.getElementById('app').innerHTML=
 '<div class="notice"><span class="badge">READ ONLY</span> &nbsp; Shared temporarily by the patient. Access expires <strong>'+esc(expires.toLocaleString())+'</strong>.</div>'+
 '<div class="grid">'+
 '<section class="card full"><h2>Patient</h2><div class="kv"><div class="k">Name</div><div class="v">'+esc(val(p.name))+'</div><div class="k">Date of birth</div><div class="v">'+esc(val(p.birthDate))+'</div><div class="k">Blood group</div><div class="v">'+esc(val(p.bloodGroup))+'</div><div class="k">Contact</div><div class="v">'+esc(val(p.telecom&&p.telecom[0]&&p.telecom[0].value))+'</div></div></section>'+
 '<section class="card"><h2>Vitals & lifestyle</h2><div class="kv"><div class="k">Height</div><div class="v">'+esc(val(v.height))+'</div><div class="k">Weight</div><div class="v">'+esc(val(v.weight))+'</div><div class="k">BMI</div><div class="v">'+esc(val(v.bmi))+'</div><div class="k">Smoking</div><div class="v">'+esc(val(l.smoking))+'</div><div class="k">Alcohol</div><div class="v">'+esc(val(l.alcohol))+'</div></div></section>'+
 '<section class="card"><h2>Emergency contact</h2><div class="kv"><div class="k">Name</div><div class="v">'+esc(val(ec.name))+'</div><div class="k">Relation</div><div class="v">'+esc(val(ec.relation))+'</div><div class="k">Phone</div><div class="v">'+esc(val(ec.phone))+'</div></div></section>'+
 '<section class="card"><h2>Medical conditions</h2>'+ (conditions.length?conditions.map(c=>'<div class="item"><strong>'+esc(val(c.code&&c.code.text))+'</strong><div class="small">'+esc(val(c.clinicalStatus&&c.clinicalStatus.text,'Status not provided'))+(c.onsetYear?' · '+esc(c.onsetYear):'')+(c.note?' · '+esc(c.note):'')+'</div></div>').join(''):'<div class="small">None recorded</div>') +'</section>'+
 '<section class="card"><h2>Current medications</h2>'+ (meds.length?meds.map(m=>'<div class="item"><strong>'+esc(val(m.medication&&m.medication.text))+'</strong><div class="small">'+esc(val(m.dose&&m.dose.text,'Dose not provided'))+' · '+esc(val(m.frequency&&m.frequency.text,'Frequency not provided'))+(m.instructions?' · '+esc(m.instructions):'')+'</div></div>').join(''):'<div class="small">None recorded</div>') +'</section>'+
 '<section class="card full"><h2>Recent visits</h2>'+ (encounters.length?encounters.slice(0,12).map(e=>'<div class="item"><strong>'+esc(date(e.date))+'</strong><div class="small">'+esc(val(e.provider,'Provider not provided'))+' · '+esc(val(e.specialty,'Specialty not provided'))+' · '+esc(val(e.facility,'Facility not provided'))+'</div></div>').join(''):'<div class="small">None recorded</div>') +'</section>'+
 '<section class="card full"><h2>Diagnostic reports</h2>'+ (reports.length?reports.slice(0,15).map(r=>'<div class="item"><strong>'+esc(date(r.date))+' · '+esc(val(r.code&&r.code.text))+'</strong><div class="small">'+esc(val(r.result&&r.result.text,'Result not provided'))+'</div></div>').join(''):'<div class="small">None recorded</div>') +'</section>'+
 '</div>';
}
fetch('/api/record-share/view?token='+encodeURIComponent(token),{headers:{Accept:'application/json'},cache:'no-store'})
 .then(async r=>{const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||'This sharing link is invalid or expired.');return body})
 .then(body=>{if(!body.payload)throw new Error('Shared record is unavailable.');render(body.payload)})
 .catch(err=>{document.getElementById('app').innerHTML='<div class="status"><div class="expired">Shared record unavailable</div><div style="margin-top:7px;color:#65736c;font-size:13px">'+esc(err.message)+'</div></div>'});
</script>
</body>
</html>`;
}

async function handleRecordShareCreate(req,res) {
  cleanupRecordShares();
  const body = await readBody(req);
  const record = body && body.record;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return json(res,400,{error:'A valid health record is required.'});
  const requestedHours = Number(body.expiresInHours);
  const expiresInHours = Number.isFinite(requestedHours) ? Math.min(24, Math.max(1, requestedHours)) : 24;
  const expiresAt = Date.now() + expiresInHours * 60 * 60 * 1000;
  const serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized,'utf8') > MAX_RECORD_SHARE_BYTES) return json(res,413,{error:'Health record is too large to create a temporary share link.'});

  const token = createRecordShareToken();
  recordShares.set(token,{record,expiresAt,createdAt:Date.now()});
  const origin = getRequestOrigin(req);
  json(res,200,{url:`${origin}/record-share?token=${encodeURIComponent(token)}`,expiresAt,expiresInHours,readOnly:true});
}

async function handleRecordShareView(req,res,url) {
  cleanupRecordShares();
  const token = String(url.searchParams.get('token') || '').trim();
  if (!token) return json(res,400,{error:'Missing share token.'});
  const share = recordShares.get(token);
  if (!share) return json(res,410,{error:'This doctor sharing link is invalid or has expired.'});
  if (Date.now() >= share.expiresAt) { recordShares.delete(token); return json(res,410,{error:'This doctor sharing link has expired.'}); }
  json(res,200,{payload:{...share.record,expiresAt:share.expiresAt,readOnly:true}});
}

const server = http.createServer(async (req,res)=>{
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Accept','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}); return res.end(); }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/health') return json(res,200,{ok:true,service:'swasthid-render-server'});
    if (req.method === 'GET' && url.pathname === '/api/medicines/search') return await handleMedicine(req,res,url);
    if (req.method === 'POST' && url.pathname === '/api/emergency/create') return await handleEmergencyCreate(req,res);
    if (req.method === 'GET' && url.pathname === '/api/emergency/view') return await handleEmergencyView(req,res,url);
    if (req.method === 'POST' && url.pathname === '/api/risk/prevent') return await handleRisk(req,res);
    if (req.method === 'POST' && url.pathname === '/api/record-share/create') return await handleRecordShareCreate(req,res);
    if (req.method === 'GET' && url.pathname === '/api/record-share/view') return await handleRecordShareView(req,res,url);
    if (req.method === 'GET' && url.pathname === '/record-share') {
      const token = String(url.searchParams.get('token') || '').trim();
      if (!token) return html(res,400,'<h1>Missing share token</h1><p>This doctor sharing link is incomplete.</p>');
      return html(res,200,recordSharePage(token));
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return fs.createReadStream(path.join(ROOT,'index.html')).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/firebase-config.js') {
      res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'});
      return fs.createReadStream(path.join(ROOT,'firebase-config.js')).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/firestore.rules') {
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});
      return fs.createReadStream(path.join(ROOT,'firestore.rules')).pipe(res);
    }
    json(res,404,{error:'Not found'});
  } catch (e) { console.error(e); json(res,500,{error:'Server error'}); }
});
server.listen(PORT,HOST,()=>console.log(`SwasthID server listening on ${HOST}:${PORT}`));
