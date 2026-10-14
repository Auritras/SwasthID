// Safety and usability fixes from the design critique: heart-risk answers come
// from the record, dose taps can be undone, the emergency card is one tap away,
// revoking the QR asks first, and features read each other's data.
const { test, expect, openApp } = require('./fixtures');

const MEDS = [
  { name: 'Metformin', dose: '500 mg', schedule: 'Twice daily', times: ['08:00', '20:00'], packSize: '60 tablets' },
  { name: 'Amlodipine', dose: '5 mg', schedule: 'Once daily', times: ['09:00'] },
  { name: 'Atorvastatin', dose: '10 mg', schedule: 'Once daily', times: ['21:00'] },
];
const LIPID_REPORT = {
  name: 'Lipid profile', date: '2026-09-01',
  values: [
    { test: 'Total cholesterol', value: 210, unit: 'mg/dL' },
    { test: 'HDL', value: 45, unit: 'mg/dL' },
    { test: 'eGFR', value: 92, unit: 'mL/min/1.73m²' },
  ],
};
const RECORD = {
  gender: 'Female', dob: '1970-05-01',
  conditions: [{ name: 'Type 2 diabetes', status: 'Active' }],
  medications: MEDS,
  reports: [LIPID_REPORT],
  vitals: { height: '160', weight: '70' },
};

test('the heart-risk form starts from the record and refuses contradictions', async ({ page, errors }) => {
  await openApp(page, RECORD);
  await page.evaluate(() => showTab('predict'));
  await expect(page.locator('#riskDiabetesInput')).toHaveValue('1');
  await expect(page.locator('#riskBpMedsInput')).toHaveValue('1');
  await expect(page.locator('#riskStatinInput')).toHaveValue('1');
  await expect(page.locator('#riskSexInput')).toHaveValue('F');
  await expect(page.locator('#riskTotalCholInput')).toHaveValue('210');
  await expect(page.locator('#riskHdlInput')).toHaveValue('45');
  await expect(page.locator('#riskEgfrInput')).toHaveValue('92');
  await expect(page.locator('#riskDiabetesInputFromRecord')).toContainText('Type 2 diabetes');

  await page.selectOption('#riskDiabetesInput', '0');
  await page.fill('#riskSbpInput', '130');
  await page.click('#calculateClinicalRiskBtn');
  await expect(page.locator('#clinicalRiskStatus')).toContainText('Your record lists Type 2 diabetes');
  await expect(page.locator('#clinicalRiskResult')).toBeHidden();
  expect(errors).toEqual([]);
});

test('a dose marked by mistake can be undone', async ({ page, errors }) => {
  await openApp(page, { medications: MEDS });
  await expect(page.locator('#doseSummaryText')).toHaveText('0 of 4 taken');
  await page.locator('#todayMedList [data-mark-med]').first().click();
  await expect(page.locator('#doseSummaryText')).toHaveText('1 of 4 taken');
  await expect(page.locator('#toastTitleText')).toHaveText('Dose recorded');
  await page.locator('#toastActions').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#doseSummaryText')).toHaveText('0 of 4 taken');
  await expect(page.locator('#todayMedList [data-mark-med]').first()).toHaveText('Mark taken');
  expect(errors).toEqual([]);
});

test('the emergency card has its own nav entry, and revoking asks first', async ({ page, errors }) => {
  await openApp(page, { bloodGroup: 'B+' });
  let revokeCalls = 0;
  await page.route('**/api/emergency-share/revoke', route => { revokeCalls++; return route.fulfill({ json: {} }); });
  await page.locator('#sidebar [data-group="emergency"], nav [data-group="emergency"]').first().click();
  await expect(page.locator('#panel-emergency')).toBeVisible();
  await expect(page.locator('#pageTitle')).toHaveText('Emergency card');
  await expect(page.locator('#subnav')).toBeHidden();

  await page.evaluate(() => { document.getElementById('revokeEmergencyQrBtn').closest('[hidden]')?.removeAttribute('hidden'); });
  await page.evaluate(() => document.getElementById('revokeEmergencyQrBtn').click());
  await expect(page.locator('#revokeConfirm')).toBeVisible();
  await page.locator('#revokeConfirm [data-revoke-no]').click();
  await expect(page.locator('#revokeConfirm')).toBeHidden();
  expect(revokeCalls).toBe(0);
  expect(errors).toEqual([]);
});

test('the doctor summary includes the latest readings and lab values', async ({ page, errors }) => {
  await page.addInitScript(() => {
    localStorage.setItem('swasth_vitals', JSON.stringify([
      { id: 'a', type: 'bp', sys: 142, dia: 90, at: '2026-10-01T08:00:00' },
      { id: 'b', type: 'bp', sys: 128, dia: 82, at: '2026-10-10T08:00:00' },
      { id: 'c', type: 'weight', weight: 64.2, at: '2026-10-11T08:00:00' },
    ]));
  });
  await openApp(page, RECORD);
  await page.evaluate(() => showTab('doctor'));
  await expect(page.locator('#doctorVitals')).toContainText('128/82');
  await expect(page.locator('#doctorVitals')).not.toContainText('142/90');
  await expect(page.locator('#doctorLabs')).toContainText('Total cholesterol 210 mg/dL');
  await expect(page.locator('#doctorSummaryText')).toContainText('Latest readings');
  // The logged weight, not the one typed at sign-up, is what the profile shows.
  await expect(page.locator('#profileWeight')).toContainText('64.2 kg');
  expect(errors).toEqual([]);
});

test('weekly nutrition averages only the days that were logged', async ({ page, errors }) => {
  await page.addInitScript(() => {
    const day = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    localStorage.setItem('swasth_foodLogs', JSON.stringify([
      { id: 1, name: 'Rice and dal', kcal: 1800, protein: 50, date: day(1) },
      { id: 2, name: 'Idli', kcal: 2200, protein: 70, date: day(2) },
    ]));
  });
  await openApp(page);
  await page.evaluate(() => showTab('nutrition'));
  await expect(page.locator('#weeklyAvgKcal')).toHaveText('2000 kcal');
  await expect(page.locator('#weeklyProtein')).toHaveText('60.0 g');
  await expect(page.locator('#weeklyCarbs')).toHaveText('—');
  await expect(page.locator('#weeklyAdherenceFood')).toHaveText('2/7');
  expect(errors).toEqual([]);
});

test('Medicines opens on the full list, with an editor for it', async ({ page, errors }) => {
  await openApp(page, { medications: MEDS });
  await page.locator('[data-group="medicines"]').first().click();
  await expect(page.locator('#panel-mymeds')).toBeVisible();
  const rows = page.locator('#myMedsList .my-med-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('Metformin · 500 mg');
  await expect(rows.first()).toContainText('days left');
  await page.click('#editMedicinesBtn');
  await expect(page.locator('#profileModal')).toHaveClass(/\bshow\b/);
  await expect(page.locator('#medicineInputRows')).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('small buttons and inputs are large enough to tap without zooming', async ({ page }) => {
    await openApp(page, { medications: MEDS });
    const sizes = await page.evaluate(() => ({
      input: parseFloat(getComputedStyle(document.querySelector('#medSearch')).fontSize),
      button: document.querySelector('#todayMedList .med-action, #todayMedList .btn-sm')?.getBoundingClientRect().height,
    }));
    expect(sizes.input).toBeGreaterThanOrEqual(16);
    await page.evaluate(() => showTab('emergency'));
    const sm = await page.locator('#refreshEmergencyQrBtn').evaluate(el => getComputedStyle(el).minHeight);
    expect(parseFloat(sm)).toBeGreaterThanOrEqual(44);
  });

  test('the chat button tucks away while scrolling down', async ({ page }) => {
    await openApp(page, { medications: MEDS });
    const dock = page.locator('#aiAssistantDock');
    await expect(dock).not.toHaveClass(/is-tucked/);
    await page.evaluate(() => { document.body.style.minHeight = '4000px'; window.scrollTo(0, 600); });
    await expect(dock).toHaveClass(/is-tucked/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(dock).not.toHaveClass(/is-tucked/);
  });
});
