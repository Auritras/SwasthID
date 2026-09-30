// Refill reminders count down as doses are marked taken.
const { test, expect, openApp } = require('./fixtures');

const item = (page, name) => page.locator('.refill-item', { hasText: name });
const markTaken = (page, name, n = 0) => page.locator('.today-med-item', { hasText: name }).nth(n).locator('.med-action').click();

test('each dose marked taken uses up the pack', async ({ page, errors }) => {
  const profile = {
    medications: [
      { name: 'Paracetamol', dose: '1 tablet', schedule: 'Twice daily', times: ['08:00', '20:00'], packSize: '30' },
      { name: 'Metrogyl', dose: '2 tablets', schedule: 'Once daily', times: ['09:00'], packSize: '15 tablets' },
    ],
  };
  await openApp(page, profile);
  await expect(item(page, 'Paracetamol')).toContainText('30 of 30 left');
  await expect(item(page, 'Paracetamol')).toContainText('~15 days left');

  await markTaken(page, 'Paracetamol', 0);
  await expect(item(page, 'Paracetamol')).toContainText('29 of 30 left');
  await expect(item(page, 'Paracetamol')).toContainText('~14 days left');
  await markTaken(page, 'Paracetamol', 1);
  await expect(item(page, 'Paracetamol')).toContainText('28 of 30 left');

  // A dose of 2 tablets uses 2.
  await markTaken(page, 'Metrogyl');
  await expect(item(page, 'Metrogyl')).toContainText('13 of 15 left');
  await expect(item(page, 'Metrogyl')).toContainText('~6 days left');
  await expect(item(page, 'Metrogyl').locator('.refill-count')).toHaveClass(/is-low/);
  await expect(item(page, 'Paracetamol').locator('.refill-count')).not.toHaveClass(/is-low/);

  // The count is saved: opening the app again (same profile) still shows it.
  await openApp(page, profile);
  await expect(item(page, 'Paracetamol')).toContainText('28 of 30 left');
  await expect(item(page, 'Metrogyl')).toContainText('13 of 15 left');
  expect(errors).toEqual([]);
});

test('"Refilled" starts a full pack, and so does changing the pack size', async ({ page }) => {
  await openApp(page, {
    medications: [{ name: 'Paracetamol', dose: '1 tablet', schedule: 'Twice daily', times: ['08:00', '20:00'], packSize: '30' }],
  });
  await markTaken(page, 'Paracetamol', 0);
  await expect(item(page, 'Paracetamol')).toContainText('29 of 30 left');

  await item(page, 'Paracetamol').getByRole('button', { name: 'Refilled' }).click();
  await expect(item(page, 'Paracetamol')).toContainText('30 of 30 left');
  await expect(page.locator('#medToast')).toContainText('Paracetamol: 30 left');

  // Doses already taken before the refill don't count against the new pack.
  await markTaken(page, 'Paracetamol', 1);
  await expect(item(page, 'Paracetamol')).toContainText('29 of 30 left');

  // A new pack size is a new pack.
  await page.evaluate(() => {
    patientData.medications[0].packSize = '60';
    localStorage.setItem('swasth_profile_medications', JSON.stringify(patientData.medications));
    renderMedicationInsights();
  });
  await expect(item(page, 'Paracetamol')).toContainText('60 of 60 left');
  await expect(item(page, 'Paracetamol')).toContainText('~30 days left');
});

test('an empty pack says refill due now', async ({ page }) => {
  await openApp(page, {
    medications: [{ name: 'Metrogyl', dose: '2 tablets', schedule: 'Once daily', times: ['09:00'], packSize: '2' }],
  });
  await expect(item(page, 'Metrogyl')).toContainText('2 of 2 left');
  await markTaken(page, 'Metrogyl');
  await expect(item(page, 'Metrogyl')).toContainText('Refill due now');
  await expect(item(page, 'Metrogyl')).toContainText('0 of 2 left');
});
