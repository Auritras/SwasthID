// Helpers for tests against the Firebase emulators (Auth and Firestore).
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const FIRESTORE = `http://${process.env.FIRESTORE_EMULATOR_HOST}`;
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-swasthid';
const PASSWORD = 'secret123';

async function post(url, body, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return res.json();
}

// Create an account; verified unless told otherwise, as the app requires.
async function createUser(prefix, { verified = true } = {}) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const user = await post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { email, password: PASSWORD, returnSecureToken: true });
  if (verified) await post(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { localId: user.localId, emailVerified: true }, { Authorization: 'Bearer owner' });
  return { email, password: PASSWORD, uid: user.localId };
}

// Mark an account made through the app's sign-up form as verified.
async function verifyByEmail(email) {
  const found = await post(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, { email: [email] }, { Authorization: 'Bearer owner' });
  const user = found.users?.[0];
  if (user) await post(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { localId: user.localId, emailVerified: true }, { Authorization: 'Bearer owner' });
  return user;
}

async function idToken(user) {
  const res = await post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { email: user.email, password: user.password, returnSecureToken: true });
  return res.idToken || null;
}

// Read a user's Firestore document, as that user, as someone else, or as the
// emulator owner (bypasses security rules).
async function readUserDoc(uid, token = 'owner') {
  return fetch(`${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}`, { headers: { Authorization: `Bearer ${token}` } });
}

// The user's saved items (one Firestore document each), read as the owner.
async function listEntries(uid) {
  const res = await fetch(`${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}/entries?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  return (await res.json()).documents || [];
}

async function logIn(page, user) {
  await page.goto('/');
  await page.fill('#healthId', user.email);
  await page.fill('#password', user.password);
  await page.click('.login-btn');
  await page.waitForFunction(() => document.getElementById('dashboard')?.style.display === 'block', null, { timeout: 30_000 });
  await page.waitForFunction(() => typeof firebaseUser !== 'undefined' && !!firebaseUser);
  // New accounts are offered the profile form shortly after login (and once
  // more if it isn't showing yet). Let that happen, then close it.
  await page.waitForFunction(() => document.getElementById('profileModal')?.classList.contains('show'), null, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.evaluate(() => window.closeProfileModal?.());
}

module.exports = { createUser, verifyByEmail, idToken, readUserDoc, listEntries, logIn };
