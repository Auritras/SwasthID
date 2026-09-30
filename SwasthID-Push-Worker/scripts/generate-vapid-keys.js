// Make a VAPID key pair for Web Push: `npm run keys`.
// The public key goes to both the Worker and the SwasthID server; the private
// key only to the Worker (as a secret).
import { base64urlEncode, base64urlDecode } from '../src/webpush.js';

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const publicKey = base64urlEncode(new Uint8Array([4, ...base64urlDecode(jwk.x), ...base64urlDecode(jwk.y)]));

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
