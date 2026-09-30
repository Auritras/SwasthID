const { test, expect, openApp } = require('./fixtures');

test.describe('installable app', () => {
  test.use({ serviceWorkers: 'allow' });

  test('caches itself and starts without a connection', async ({ page, context, errors }) => {
    await openApp(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(async () => {
      const keys = await (await caches.open('swasthid-v1')).keys();
      return keys.map(r => new URL(r.url).pathname);
    })).toEqual(expect.arrayContaining(['/', '/assets/app.css', '/assets/js/cloud-sync.js', '/assets/js/pwa.js', '/firebase-config.js']));

    // A reading saved while online is still there offline.
    await page.evaluate(() => localStorage.setItem('swasth_vitals', JSON.stringify([{ id: 'bp1', type: 'bp', sys: 128, dia: 82, at: new Date().toISOString() }])));
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('dashboard')?.style.display === 'block');
    await expect(page.locator('#offlineBanner')).toBeVisible();
    await page.evaluate(() => showTab('vitals'));
    await expect(page.locator('#vitalsLatest')).toContainText('128/82');
    await context.setOffline(false);
    expect(errors).toEqual([]);
  });

  test('never serves live API answers from the cache', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.evaluate(() => fetch('/health'));
    const cachedApi = await page.evaluate(async () => (await (await caches.open('swasthid-v1')).keys()).filter(r => /^\/(api\/|health$)/.test(new URL(r.url).pathname)).length);
    expect(cachedApi).toBe(0);
  });
});

test('"Install app" stays out of the account menu until the browser offers installing', async ({ page }) => {
  await openApp(page);
  await page.click('#accountBtn');
  await expect(page.locator('#accountMenu')).toBeVisible();
  await expect(page.locator('#installAppBtn')).toBeHidden();
});

// What the browser does when it would let the user install SwasthID.
const offerInstall = (page, outcome = 'accepted') => page.evaluate(outcome => {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  event.prompt = () => { window.__prompted = true; };
  event.userChoice = Promise.resolve({ outcome });
  window.dispatchEvent(event);
}, outcome);

test('"Install app" is offered, and goes away for good once installed', async ({ page }) => {
  await openApp(page);
  await offerInstall(page);
  await page.click('#accountBtn');
  await expect(page.locator('#installAppBtn')).toBeVisible();
  await page.click('#installAppBtn');
  expect(await page.evaluate(() => window.__prompted)).toBe(true);
  await expect(page.locator('#installAppBtn')).toBeHidden();

  // Back in a browser tab later, even if the browser offers installing again.
  await openApp(page);
  await offerInstall(page);
  await page.click('#accountBtn');
  await expect(page.locator('#accountMenu')).toBeVisible();
  await expect(page.locator('#installAppBtn')).toBeHidden();
});

test('"Install app" stays hidden if the install is dismissed and then made from the browser menu', async ({ page }) => {
  await openApp(page);
  await offerInstall(page, 'dismissed');
  await page.click('#accountBtn');
  await page.click('#installAppBtn');
  // Dismissed: still offered.
  await offerInstall(page);
  await page.click('#accountBtn');
  await expect(page.locator('#installAppBtn')).toBeVisible();
  // Installed another way (the browser's own menu).
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.locator('#medToast')).toContainText('SwasthID installed');
  await expect(page.locator('#installAppBtn')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('swasthid:installed'))).toBe('1');
});

test('inside the installed app, "Install app" never shows', async ({ page }) => {
  // Opened from the home screen: the page runs in the app's own window.
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(display-mode: standalone)' ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} } : real(query);
  });
  await openApp(page);
  await offerInstall(page);
  await page.click('#accountBtn');
  await expect(page.locator('#accountMenu')).toBeVisible();
  await expect(page.locator('#installAppBtn')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('swasthid:installed'))).toBe('1');
});

test('has a complete web app manifest', async ({ request }) => {
  const manifest = await (await request.get('/assets/site.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'SwasthID', start_url: '/', display: 'standalone' });
  expect(manifest.icons.map(i => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
});
