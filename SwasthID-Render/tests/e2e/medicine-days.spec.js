// Medicines taken on chosen days of the week rather than every day.
const { test, expect, openApp } = require('./fixtures');

const today = new Date().getDay();
const otherDay = (today + 3) % 7; // a day that isn't today
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Open the profile form on the step that holds the medicine editor.
async function openMedicineEditor(page, medications) {
  await page.evaluate(meds => {
    patientData.medications = meds;
    openProfileModal({ force: true });
    document.getElementById('medicineInputRows').closest('.profile-wizard-step')?.classList.remove('profile-wizard-hidden');
  }, medications);
  await expect(page.locator('#medicineInputRows .medicine-input-row').first()).toBeVisible();
}

test('choosing days in the medicine editor saves them, and adding a row keeps them', async ({ page, errors }) => {
  await openApp(page);
  await openMedicineEditor(page, [{ name: 'Vitamin D3', dose: '60000 IU', schedule: 'Once daily', times: ['09:00'] }]);
  const row = page.locator('#medicineInputRows .medicine-input-row').first();
  await expect(row.locator('.med-days-summary')).toHaveText('Every day');

  // Keep only Monday and Thursday.
  for (const day of [0, 2, 3, 5, 6]) await row.locator(`.med-day[data-day="${day}"]`).click();
  await expect(row.locator('.med-days-summary')).toHaveText('Mon, Thu');
  await expect(row.locator('.med-day[data-day="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row.locator('.med-day[data-day="0"]')).toHaveAttribute('aria-pressed', 'false');

  // The last selected day can't be turned off.
  await row.locator('.med-day[data-day="1"]').click();
  await row.locator('.med-day[data-day="4"]').click();
  await expect(row.locator('.med-day[data-day="4"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row.locator('.med-days-summary')).toHaveText('Thu');
  await row.locator('.med-day[data-day="1"]').click();

  // Adding another medicine must not reset the first one's days.
  await page.evaluate(() => window.__addMedicineRow());
  await expect(page.locator('#medicineInputRows .medicine-input-row')).toHaveCount(2);
  await expect(row.locator('.med-days-summary')).toHaveText('Mon, Thu');

  // Saving the profile keeps the days (the blank second row is dropped).
  await page.evaluate(() => savePersonalizedProfile());
  const saved = await page.evaluate(() => patientData.medications);
  expect(saved).toHaveLength(1);
  expect(saved[0].days).toEqual([1, 4]);
  expect(errors).toEqual([]);
});

test('every day is stored as no days, so older medicines behave as before', async ({ page }) => {
  await openApp(page);
  await openMedicineEditor(page, [{ name: 'Metformin', dose: '500 mg', schedule: 'Twice daily', times: ['08:00', '20:00'] }]);
  const saved = await page.evaluate(() => readMedicineRows());
  expect(saved[0].days).toBeUndefined();
});

test('an older "weekly" medicine shows the day it has been falling on', async ({ page }) => {
  await openApp(page);
  await openMedicineEditor(page, [{ name: 'Alendronate', dose: '70 mg', schedule: 'Weekly', times: ['07:00'] }]);
  await expect(page.locator('#medicineInputRows .med-days-summary').first()).toHaveText('Mon');
});

test('today\'s list shows only medicines due today and mentions the rest', async ({ page }) => {
  await openApp(page, {
    medications: [
      { name: 'Metformin', dose: '500 mg', schedule: 'Once daily', times: ['08:00'] },
      { name: 'Methotrexate', dose: '7.5 mg', schedule: 'Once daily', times: ['09:00'], days: [otherDay] },
      { name: 'Vitamin D3', dose: '60000 IU', schedule: 'Once daily', times: ['10:00'], days: [today] },
    ],
  });
  const list = page.locator('#todayMedList');
  await expect(list).toContainText('Metformin');
  await expect(list).toContainText('Vitamin D3');
  await expect(list.locator('.today-med-item', { hasText: 'Vitamin D3' })).toContainText(`Once daily · ${DAY_NAMES[today]}`);
  await expect(list.locator('.today-med-item', { hasText: 'Methotrexate' })).toHaveCount(0);
  await expect(list.locator('.today-med-later')).toHaveText(`Not due today: Methotrexate (${DAY_NAMES[otherDay]})`);
  await expect(page.locator('#doseSummaryText')).toHaveText('0 of 2 taken');
});

test('the calendar file repeats on the chosen weekdays', async ({ page }) => {
  await openApp(page, { medications: [{ name: 'Methotrexate', dose: '7.5 mg', schedule: 'Once daily', times: ['09:00'], days: [1, 4] }] });
  const ics = await page.evaluate(() => window.buildDoseCalendar());
  expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,TH');
  // The first entry falls on a Monday or Thursday.
  const start = /DTSTART:(\d{4})(\d{2})(\d{2})T/.exec(ics);
  const weekday = new Date(Number(start[1]), Number(start[2]) - 1, Number(start[3])).getDay();
  expect([1, 4]).toContain(weekday);
});

test('refill estimates count only the days a medicine is taken', async ({ page }) => {
  await openApp(page, {
    medications: [
      { name: 'Methotrexate', dose: '1 tablet', schedule: 'Once daily', times: ['09:00'], days: [1, 4], packSize: '8 tablets' },
      { name: 'Metformin', dose: '1 tablet', schedule: 'Once daily', times: ['08:00'], packSize: '8 tablets' },
    ],
  });
  const panel = page.locator('#medRefillPanel, .refill-item').first();
  await expect(page.locator('.refill-item', { hasText: 'Methotrexate' })).toContainText('~28 days left');
  await expect(page.locator('.refill-item', { hasText: 'Methotrexate' })).toContainText('on Mon, Thu');
  await expect(page.locator('.refill-item', { hasText: 'Metformin' })).toContainText('~8 days left');
  await expect(panel).toBeVisible();
});
