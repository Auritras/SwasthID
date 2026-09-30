// Web Push without a payload: a POST to the browser's push endpoint, signed
// with our VAPID key (RFC 8292). With no payload there is nothing to
// encrypt; the phone's service worker works out which medicines are due.

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

// Send one push. Returns the push service's HTTP status (201 = accepted;
// 404 or 410 = the browser unsubscribed, so forget this endpoint).
export async function sendPush(endpoint, env, { ttl = 1800, fetchImpl = fetch } = {}) {
  if (!isPushEndpoint(endpoint)) return 400;
  const jwt = await vapidToken({
    audience: new URL(endpoint).origin,
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  });
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      // A dose reminder that arrives more than 30 minutes late is no use.
      TTL: String(ttl),
      Urgency: 'high',
      'Content-Length': '0',
    },
  });
  return res.status;
}
