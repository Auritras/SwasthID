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

test('has a complete web app manifest', async ({ request }) => {
  const manifest = await (await request.get('/assets/site.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'SwasthID', start_url: '/', display: 'standalone' });
  expect(manifest.icons.map(i => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
});
