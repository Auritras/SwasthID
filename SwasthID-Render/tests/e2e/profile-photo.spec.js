const path = require('path');
const { test, expect, openApp } = require('./fixtures');

const IMAGE = path.join(__dirname, '../../assets/og-image.png');

test('shows a silhouette, then an uploaded photo, then the silhouette again', async ({ page, errors }) => {
  await openApp(page);
  await expect(page.locator('#heroAvatar svg')).toBeVisible();
  await page.evaluate(() => showTab('profile'));
  await page.setInputFiles('#profilePhotoInput', IMAGE);
  // The header and the Profile card show it; Home (hidden now) has it too.
  await expect(page.locator('#accountInitials img')).toBeVisible();
  await expect(page.locator('.profile-photo-card [data-avatar] img')).toBeVisible();
  await expect(page.locator('#heroAvatar img')).toBeAttached();
  const photo = await page.evaluate(() => ({ size: patientData.photo.length, type: patientData.photo.slice(5, 15) }));
  expect(photo.size).toBeLessThan(40_000);
  expect(photo.type).toMatch(/^image\/(webp|jpeg)/);
  await expect(page.locator('#profilePhotoBtn')).toHaveText('Change photo');
  await page.click('#removeProfilePhotoBtn');
  await expect(page.locator('#accountInitials svg')).toBeVisible();
  await expect(page.locator('#heroAvatar img')).toHaveCount(0);
  expect(await page.evaluate(() => patientData.photo)).toBe('');
  expect(errors).toEqual([]);
});

test('refuses a file that is not an image', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => showTab('profile'));
  await page.setInputFiles('#profilePhotoInput', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('#profilePhotoError')).toHaveText('Choose an image file, such as a JPG or PNG.');
  await expect(page.locator('#accountInitials svg')).toBeVisible();
});
