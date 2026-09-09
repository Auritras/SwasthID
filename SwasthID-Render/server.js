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

if (!EMERGENCY_SECRET) console.warn('WARNING: EMERGENCY_SECRET is not set. Emergency token creation will be disabled until configured.');

function json(res, status, body) {
  const out = JSON.stringify(body);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
  res.end(out);
}
function html(res, status, body) {
  res.writeHead(status, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
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

const server = http.createServer(async (req,res)=>{
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Accept','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}); return res.end(); }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/health') return json(res,200,{ok:true,service:'swasthid-render-server'});
    if (req.method === 'GET' && url.pathname === '/api/medicines/search') return await handleMedicine(req,res,url);
    if (req.method === 'POST' && url.pathname === '/api/emergency/create') return await handleEmergencyCreate(req,res);
    if (req.method === 'GET' && url.pathname === '/api/emergency/view') return await handleEmergencyView(req,res,url);
    if (req.method === 'POST' && url.pathname === '/api/risk/prevent') return await handleRisk(req,res);
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
