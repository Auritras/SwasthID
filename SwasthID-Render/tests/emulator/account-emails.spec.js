// Password reset and email verification emails, sent by our server through
// SMTP (a local catcher here) and opened on our /auth/action page.
const { test, expect } = require('../e2e/fixtures');
const { SMTPServer } = require('smtp-server');
const { createUser, idToken } = require('./helpers');

test.use({ signedIn: false });

const SMTP_PORT = 2525; // matches SMTP_PORT for the emulator server in playwright.config.js
const inbox = [];
let smtp;

test.beforeAll(async () => {
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onAuth: (auth, session, cb) => cb(null, { user: auth.username }),
    onData(stream, session, cb) {
      let raw = '';
      stream.on('data', chunk => { raw += chunk; });
      stream.on('end', () => {
        inbox.push({ to: session.envelope.rcptTo.map(r => r.address.toLowerCase()), raw });
        cb();
      });
    },
  });
  await new Promise((resolve, reject) => { smtp.once('error', reject); smtp.listen(SMTP_PORT, '127.0.0.1', resolve); });
});

test.afterAll(async () => {
  await new Promise(resolve => smtp.close(resolve));
});

// Undo quoted-printable encoding, which mail libraries use for long lines.
function decodeQp(raw) {
  return raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

async function waitForMail(to) {
  for (let i = 0; i < 100; i++) {
    const mail = inbox.find(m => m.to.includes(to.toLowerCase()));
    if (mail) return decodeQp(mail.raw);
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`No email arrived for ${to}`);
}

function actionLink(mail) {
  const match = /https?:\/\/[^\s"<>]+\/auth\/action\?[^\s"<>]+/.exec(mail);
  if (!match) throw new Error('No /auth/action link in the email');
  return match[0].replace(/&amp;/g, '&');
}

test('forgot password: our email, our page, then log in with the new password', async ({ page }) => {
  const user = await createUser('reset');
  await page.goto('/');
  await page.fill('#healthId', user.email);
  await page.click('.forgot-link');
  await expect(page.locator('#medToast')).toContainText('If an account exists for that address');

  const mail = await waitForMail(user.email);
  expect(mail).toContain('Subject: Reset your SwasthID password');
  expect(mail).toContain('Choose a new password');
  const link = actionLink(mail);
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/action\?mode=resetPassword&oobCode=/);

  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await expect(page.locator('#resetEmail')).toHaveText(user.email);
  // The one-time code is taken out of the address bar.
  expect(page.url()).not.toContain('oobCode');

  await page.fill('#newPassword', 'newpass1');
  await page.fill('#confirmNewPassword', 'different');
  await page.click('#resetSubmit');
  await expect(page.locator('#resetError')).toHaveText("The two passwords don't match.");

  await page.fill('#confirmNewPassword', 'newpass1');
  await page.click('#resetSubmit');
  await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();

  expect(await idToken({ email: user.email, password: 'newpass1' })).toBeTruthy();
  expect(await idToken(user)).toBeNull();

  // The link works once.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
});

test('no account for the address: same message, no email', async ({ page }) => {
  const email = `nobody-${Date.now()}@example.com`;
  // The server answers for itself, without handing over to Firebase.
  const res = await fetch(new URL('/api/auth/password-reset', test.info().project.use.baseURL), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  expect(res.status).toBe(200);
  await page.goto('/');
  await page.fill('#healthId', email);
  await page.click('.forgot-link');
  await expect(page.locator('#medToast')).toContainText('If an account exists for that address');
  await page.waitForTimeout(500);
  expect(inbox.some(m => m.to.includes(email))).toBe(false);
});

test('logging in unverified sends our verification email, and its link confirms the address', async ({ page }) => {
  const user = await createUser('verify', { verified: false });
  await page.goto('/');
  await page.fill('#healthId', user.email);
  await page.fill('#password', user.password);
  await page.click('.login-btn');
  await expect(page.locator('#medToast')).toContainText('verify your email');

  const mail = await waitForMail(user.email);
  expect(mail).toContain('Subject: Confirm your email for SwasthID');
  await page.goto(actionLink(mail));
  await expect(page.getByRole('heading', { name: 'Email address confirmed' })).toBeVisible();

  const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: await idToken(user) }),
  });
  expect((await res.json()).users[0].emailVerified).toBe(true);
});

test('when Firebase sends the email, its link still opens our page and leads back to the app', async ({ page }) => {
  const user = await createUser('firebase-reset');
  // As on Render's free plan: the server can't send email.
  await page.route('**/api/auth/password-reset', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  await page.goto('/');
  await page.fill('#healthId', user.email);
  await page.click('.forgot-link');
  await expect(page.locator('#medToast')).toContainText('If an account exists for that address');

  // The link Firebase would email, with the way back to the app attached.
  const project = process.env.GCLOUD_PROJECT || 'demo-swasthid';
  let code;
  await expect.poll(async () => {
    const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${project}/oobCodes`);
    code = (await res.json()).oobCodes.find(c => c.email === user.email && c.requestType === 'PASSWORD_RESET');
    return !!code;
  }).toBe(true);
  const sent = new URL(code.oobLink);
  const origin = new URL(page.url()).origin;
  expect(sent.searchParams.get('continueUrl')).toBe(`${origin}/`);

  // With the action URL set in the Firebase console, the link opens our page.
  await page.goto(`/auth/action?mode=resetPassword&oobCode=${code.oobCode}&apiKey=demo-key&continueUrl=${encodeURIComponent(`${origin}/`)}&lang=en`);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.fill('#newPassword', 'fbpass1');
  await page.fill('#confirmNewPassword', 'fbpass1');
  await page.click('#resetSubmit');
  await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();
  await expect(page.locator('[data-state="reset-done"] a')).toHaveAttribute('href', '/');
  expect(await idToken({ email: user.email, password: 'fbpass1' })).toBeTruthy();
});

test('a way back to another site is ignored', async ({ page }) => {
  await page.goto('/auth/action?mode=verifyEmail&oobCode=bad&continueUrl=https%3A%2F%2Fevil.example%2Fphish');
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  await expect(page.locator('[data-state="invalid"] a')).toHaveAttribute('href', '/');
});

test('a broken link explains itself', async ({ page }) => {
  await page.goto('/auth/action?mode=resetPassword&oobCode=not-a-real-code');
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  await page.goto('/auth/action');
  await expect(page.getByRole('heading', { name: 'This link is incomplete' })).toBeVisible();
});
