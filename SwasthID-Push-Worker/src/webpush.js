// Web Push: a POST to the browser's push endpoint, signed with our VAPID key
// (RFC 8292). The message, when there is one, is encrypted for that browser
// alone (RFC 8291). It only says what kind of reminder this is and at which
// dose times; the phone's service worker looks up which medicines those are.

const enc = new TextEncoder();

export function base64urlEncode(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(text) {
  const s = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

// Push services we send to. Anything else is refused, so a stored endpoint
// can't turn the Worker into a way to POST to arbitrary sites.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge, Samsung Internet, Opera
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^web\.push\.apple\.com$/, // Safari (iPhone home-screen apps, Mac)
  /\.notify\.windows\.com$/, // legacy Edge
];

export function isPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && PUSH_HOSTS.some(re => re.test(url.hostname));
  } catch {
    return false;
  }
}

let signingKey = null; // { publicKey, key } for the current VAPID keys
const tokens = new Map(); // audience -> { jwt, exp }, reused while this Worker instance lives

async function importVapidKey(publicKey, privateKey) {
  if (signingKey?.publicKey === publicKey) return signingKey.key;
  const pub = base64urlDecode(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY must be an uncompressed P-256 key.');
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    x: base64urlEncode(pub.slice(1, 33)),
    y: base64urlEncode(pub.slice(33, 65)),
    d: privateKey,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  signingKey = { publicKey, key };
  tokens.clear();
  return key;
}

// A signed token saying "this push comes from the owner of the VAPID key".
export async function vapidToken({ audience, subject, publicKey, privateKey, now = Date.now() }) {
  const key = await importVapidKey(publicKey, privateKey);
  const cached = tokens.get(audience);
  if (cached && cached.exp * 1000 - now > 60 * 60 * 1000) return cached.jwt;
  const exp = Math.floor(now / 1000) + 12 * 60 * 60;
  const header = base64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64urlEncode(enc.encode(JSON.stringify({ aud: audience, exp, sub: subject })));
  // WebCrypto returns the signature as r || s, the form JWTs use.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${base64urlEncode(signature)}`;
  tokens.set(audience, { jwt, exp });
  return jwt;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function hkdf(salt, ikm, info, bits) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits));
}

// Encrypt `plaintext` for one browser (RFC 8291, "aes128gcm"). p256dh and
// auth are the keys from the browser's push subscription.
export async function encryptPayload({ p256dh, auth }, plaintext, { salt = crypto.getRandomValues(new Uint8Array(16)) } = {}) {
  const uaPublic = base64urlDecode(p256dh);
  const authSecret = base64urlDecode(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error('Bad subscription keys.');
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 256);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 96);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the message, then the 0x02 "last record" delimiter.
  const record = concat(enc.encode(plaintext), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record));
  // Header: salt, record size (4096), key id length, our public key.
  return concat(salt, new Uint8Array([0, 0, 16, 0, 65]), asPublic, cipher);
}

// Send one push, with an encrypted `message` when the browser's keys are
// known. Returns the push service's HTTP status (201 = accepted; 404 or
// 410 = the browser unsubscribed, so forget this endpoint).
export async function sendPush(endpoint, env, { ttl = 1800, fetchImpl = fetch, keys = null, message = null } = {}) {
  if (!isPushEndpoint(endpoint)) return 400;
  const jwt = await vapidToken({
    audience: new URL(endpoint).origin,
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  });
  const body = message != null && keys?.p256dh && keys?.auth ? await encryptPayload(keys, JSON.stringify(message)) : null;
  const headers = {
    Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    // A dose reminder that arrives more than 30 minutes late is no use.
    TTL: String(ttl),
    Urgency: 'high',
    'Content-Length': String(body ? body.length : 0),
  };
  if (body) Object.assign(headers, { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' });
  const res = await fetchImpl(endpoint, { method: 'POST', headers, body: body || undefined });
  return res.status;
}
