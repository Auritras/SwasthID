// Shared setup for the browser tests.
//
// - Tests never reach third-party services: map servers, IP location, food
//   and medicine APIs and the AI library are blocked, and tests that need
//   them fake the responses.
// - CDN libraries (jsPDF, the QR library, the Firebase SDK) load from the
//   internet. Where there is none, set CDN_MIRROR to a node_modules folder
//   that contains them and they are served from there.
// - `signedIn` (default true) starts the app signed in to a demo-mode account.
const base = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BLOCKED = /overpass|maps\.mail\.ru|ipwho\.is|api\.nal\.usda\.gov|openfoodfacts\.org|esm\.run|drugsetu\.in|huggingface\.co/;
const CDN = /^https:\/\/(www\.gstatic\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
const MIRROR_FILES = {
  'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js',
  'qrcode.min.js': 'qrcodejs/qrcode.min.js',
  'firebase-app-compat.js': 'firebase/firebase-app-compat.js',
  'firebase-auth-compat.js': 'firebase/firebase-auth-compat.js',
  'firebase-firestore-compat.js': 'firebase/firebase-firestore-compat.js',
};

// Network rules for a browser context (also used for extra contexts that a
// test opens itself, e.g. a second device).
async function prepareContext(context) {
  await context.route(BLOCKED, route => route.abort());
  const mirror = process.env.CDN_MIRROR;
  if (mirror) {
    await context.route(CDN, route => {
      const url = route.request().url();
      if (url.includes('fonts.')) return route.fulfill({ contentType: 'text/css', body: '' });
      const rel = MIRROR_FILES[url.split('?')[0].split('/').pop()];
      const file = rel && path.join(mirror, rel);
      if (file && fs.existsSync(file)) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(file) });
      return route.abort();
    });
  }
}

const test = base.test.extend({
  signedIn: [true, { option: true }],

  context: async ({ context, signedIn }, use) => {
    await prepareContext(context);
    if (signedIn) {
      await context.addInitScript(() => {
        if (sessionStorage.getItem('__testSeeded')) return;
        localStorage.setItem('swasth_loggedIn', 'true');
        localStorage.setItem('swasth_abhaId', 'tester@example.com');
        sessionStorage.setItem('__testSeeded', '1');
      });
    }
    await use(context);
  },

  // Page errors fail the test unless it expects them.
  errors: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await use(errors);
  },
});

// Open the app and wait for the dashboard, with an optional profile.
async function openApp(page, profile = {}) {
  await page.goto('/');
  await page.waitForFunction(() => document.getElementById('dashboard')?.style.display === 'block');
  // A new account is offered the profile form shortly after login (and once
  // more if it isn't showing yet). Let that happen, then close it.
  await page.waitForFunction(() => document.getElementById('profileModal')?.classList.contains('show'), null, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.evaluate(p => {
    Object.assign(patientData, { name: 'Riya Sen', firstName: 'Riya', profileCompleted: true, ...p });
    window.closeProfileModal?.();
    renderPersonalizedUI();
  }, profile);
  await base.expect(page.locator('#profileModal')).not.toHaveClass(/\bshow\b/);
}

module.exports = { test, expect: base.expect, openApp, prepareContext };
