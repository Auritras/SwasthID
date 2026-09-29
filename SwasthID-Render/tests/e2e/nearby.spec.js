const { test, expect, openApp } = require('./fixtures');

const PLACES = {
  elements: [
    { id: 1, lat: 22.5731, lon: 88.3650, tags: { name: 'City Hospital', amenity: 'hospital', emergency: 'yes' } },
    { id: 2, lat: 22.5728, lon: 88.3640, tags: { name: 'Jan Aushadhi Kendra', amenity: 'pharmacy' } },
    { id: 3, lat: 22.5740, lon: 88.3660, tags: { name: 'Care Clinic', amenity: 'clinic' } },
  ],
};

async function atLocation(context, accuracy) {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 22.5726, longitude: 88.3639, accuracy });
}

test('lists places around a precise location, closest first', async ({ page, context, errors }) => {
  await atLocation(context, 15);
  await context.route('**/api/nearby?**', route => route.fulfill({ json: PLACES }));
  await openApp(page);
  await page.click('#findNearbyBtn');
  await expect(page.locator('.place-row')).toHaveCount(3);
  await expect(page.locator('.place-name').first()).toHaveText('Jan Aushadhi Kendra');
  await expect(page.locator('#nearbySubtitle')).toHaveText(/^3 places within \d+ km/);
  await expect(page.locator('#nearbyNote')).toBeHidden();
  await expect(page.locator('[data-nearby-filter="generic"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('says when the location is only approximate', async ({ page, context }) => {
  test.slow(); // waits for a better fix before settling for the coarse one
  await atLocation(context, 2600);
  await context.route('**/api/nearby?**', route => route.fulfill({ json: PLACES }));
  await openApp(page);
  await page.click('#findNearbyBtn');
  await expect(page.locator('.place-row')).toHaveCount(3, { timeout: 30_000 });
  await expect(page.locator('#nearbyNote')).toBeVisible();
  await expect(page.locator('#nearbyNote')).toContainText('only accurate to about 2.6 km');
  await expect(page.locator('#nearbySubtitle')).toHaveText(/^3 places/);
});

test('explains the failure when no map server answers', async ({ page, context }) => {
  await atLocation(context, 15);
  await context.route('**/api/nearby?**', route => route.fulfill({ status: 502, json: { error: 'The map servers did not answer.', reasons: ['overpass-api.de: HTTP 504'] } }));
  await openApp(page);
  await page.click('#findNearbyBtn');
  await expect(page.locator('#nearbyFallbackTitle')).toHaveText('Could not load nearby places', { timeout: 30_000 });
  await expect(page.locator('#nearbyFallbackDetail')).toContainText('overpass-api.de: HTTP 504');
});
