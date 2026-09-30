// The Health Vault file holds the whole record, and "Restore from file"
// brings it back after showing what the file holds.
const { test, expect, openApp } = require('./fixtures');

const PROFILE = {
  name: 'Riya Sen',
  bloodGroup: 'B+',
  conditions: [{ name: 'Type 2 diabetes', status: 'Active', year: '2021' }],
  allergies: ['Penicillin'],
  medications: [{ name: 'Metformin', dose: '1 tablet', schedule: 'Twice daily', times: ['08:00', '20:00'], packSize: '30' }],
  visits: [{ date: '2026-08-01', doctor: 'Dr Rao', specialty: 'Endocrinology' }],
  reports: [{ date: '2026-08-02', name: 'HbA1c', result: '6.8 %' }],
};

async function download(page) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.click('#exportHealthJsonBtn')]);
  return JSON.parse(require('fs').readFileSync(await file.path(), 'utf8'));
}

async function choose(page, json, name = 'SwasthID-My-Health-Vault.json') {
  await page.setInputFiles('#restoreHealthJsonInput', { name, mimeType: 'application/json', buffer: Buffer.from(typeof json === 'string' ? json : JSON.stringify(json)) });
}

test('the file holds the whole record, and restoring it brings every part back', async ({ page, errors }) => {
  await openApp(page, PROFILE);
  await page.evaluate(() => {
    localStorage.setItem('swasth_profile_medications', JSON.stringify(patientData.medications));
    localStorage.setItem('swasth_vitals', JSON.stringify([
      { id: 'v1', type: 'bp', sys: 128, dia: 82, at: '2026-09-01T08:00:00.000Z' },
      { id: 'v2', type: 'weight', weight: 64.5, at: '2026-09-02T08:00:00.000Z' },
    ]));
    localStorage.setItem('swasth_foodLogs', JSON.stringify([{ id: 1, name: 'Idli', kcal: 180, date: '2026-09-02' }]));
    localStorage.setItem('swasth_dependents', JSON.stringify([{ id: 'd1', name: 'Asha Sen', relation: 'Mother' }]));
    localStorage.setItem('swasth_prescriptions', JSON.stringify([{ id: 'rx1', date: '2026-08-01', doctor: 'Dr Rao', medicines: [{ medicine: 'Metformin', dose: '500 mg' }] }]));
    renderPersonalizedUI();
  });
  await page.locator('.today-med-item', { hasText: 'Metformin' }).first().locator('.med-action').click();
  await expect(page.locator('.refill-item', { hasText: 'Metformin' })).toContainText('29 of 30 left');
  await page.evaluate(() => showTab('share'));

  const saved = await download(page);
  expect(saved.vitalsLog.map(v => v.id)).toEqual(['v1', 'v2']);
  expect(saved.doseHistory).toEqual([expect.objectContaining({ medicine: 'Metformin', taken: true })]);
  expect(saved.foodLog).toEqual([expect.objectContaining({ name: 'Idli' })]);
  expect(saved.family).toEqual([{ id: 'd1', name: 'Asha Sen', relation: 'Mother' }]);
  expect(saved.refills.metformin).toMatchObject({ units: 30, label: '30' });
  expect(saved.swasthid).toMatchObject({ version: 1, profile: { name: 'Riya Sen', bloodGroup: 'B+' }, prescriptions: [expect.objectContaining({ id: 'rx1' })] });
  expect(saved.swasthid.profile.ownerUid).toBeUndefined();
  // The readable sections are still there for other apps and people.
  expect(saved.conditions[0].code.text).toBe('Type 2 diabetes');

  // A new phone: nothing there yet.
  await page.evaluate(() => {
    Object.keys(patientData).forEach(k => { if (!['email', 'ownerUid', 'ownerEmail'].includes(k)) delete patientData[k]; });
    ['swasth_vitals', 'swasth_foodLogs', 'swasth_dependents', 'swasth_prescriptions', 'swasth_medStatus', 'swasth_refills', 'swasth_profile_medications'].forEach(k => localStorage.removeItem(k));
    renderPersonalizedUI();
  });

  // The file is shown first; Cancel changes nothing.
  await choose(page, saved);
  const panel = page.locator('#restoreHealthPanel');
  await expect(panel).toContainText('Restore from SwasthID-My-Health-Vault.json?');
  for (const [label, value] of [['Name', 'Riya Sen'], ['Medicines', '1 medicine'], ['Vitals', '2 readings'], ['Doses taken', '1 dose'], ['Food log', '1 meal'], ['Family', '1 person'], ['Prescriptions', '1 prescription']]) {
    await expect(panel.locator('.restore-summary div', { hasText: label }).first()).toContainText(value);
  }
  await expect(panel).toContainText('This replaces your current record');
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#healthShareStatus')).toHaveText('Restore cancelled. Nothing was changed.');
  expect(await page.evaluate(() => patientData.name)).toBeUndefined();

  await choose(page, saved);
  await page.getByRole('button', { name: 'Replace my record' }).click();
  await expect(page.locator('#medToast')).toContainText('Riya Sen is back');
  await expect(page.locator('#healthShareStatus')).toHaveText('Record restored from the file.');
  await expect(page.locator('.today-med-item', { hasText: 'Metformin' }).first()).toHaveClass(/taken/);
  await expect(page.locator('.refill-item', { hasText: 'Metformin' })).toContainText('29 of 30 left');

  // Downloading again gives the same file.
  const again = await download(page);
  expect({ ...again, generatedAt: null }).toEqual({ ...saved, generatedAt: null });
  expect(errors).toEqual([]);
});

test('a file from an earlier version restores what it has and leaves the rest', async ({ page }) => {
  await openApp(page, { name: 'Current Name' });
  await page.evaluate(() => localStorage.setItem('swasth_vitals', JSON.stringify([{ id: 'keep', type: 'spo2', spo2: 98, at: '2026-09-01T08:00:00.000Z' }])));
  await page.evaluate(() => showTab('share'));
  await choose(page, {
    resourceType: 'Bundle', type: 'collection', generatedAt: '2026-05-01T10:00:00.000Z',
    meta: { profile: 'SwasthID Health Summary' },
    patient: { name: 'Old File', birthDate: '1990-04-02', bloodGroup: 'O+' },
    conditions: [{ code: { text: 'Asthma' }, clinicalStatus: { text: 'Active' }, onsetYear: '2010' }],
    allergies: { drug: ['Aspirin'], other: [] },
    medications: [
      { medication: { text: 'Salbutamol' }, dose: { text: '2 puffs' }, frequency: { text: 'As needed' } },
      { medication: { text: 'Montelukast' }, dose: { text: '10 mg' }, frequency: { text: 'Once daily' } },
    ],
    prescriptions: [{ id: 'rx9', authoredOn: '2026-04-01', requester: { display: 'Dr Iyer' }, medications: [{ medicine: 'Salbutamol' }] }],
    encounters: [], diagnosticReports: [],
  }, 'old-backup.json');
  const panel = page.locator('#restoreHealthPanel');
  await expect(panel).toContainText('made by an earlier version');
  await expect(panel.locator('.restore-summary')).not.toContainText('Vitals');
  // Salbutamol is in both the medicines and the prescription: once is enough.
  await expect(panel.locator('.restore-summary div', { hasText: 'Medicines' })).toContainText('2 medicines');
  await panel.getByRole('button', { name: 'Replace my record' }).click();
  await expect(page.locator('#medToast')).toContainText('Old File is back');
  expect(await page.evaluate(() => ({ name: patientData.name, dob: patientData.dob, conditions: patientData.conditions.map(c => c.name), meds: getCurrentMedicationList().map(m => m.medicine) })))
    .toEqual({ name: 'Old File', dob: '1990-04-02', conditions: ['Asthma'], meds: ['Montelukast', 'Salbutamol'] });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('swasth_prescriptions'))[0].doctor)).toBe('Dr Iyer');
  // Not in the file: kept.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('swasth_vitals'))[0].id)).toBe('keep');
});

test('other files are refused without changing anything', async ({ page }) => {
  await openApp(page, { name: 'Riya Sen' });
  await page.evaluate(() => showTab('share'));
  const status = page.locator('#healthShareStatus');
  await choose(page, 'not json at all');
  await expect(status).toHaveText('This file could not be read. Choose the .json file from "Download file".');
  await choose(page, { resourceType: 'Patient', name: 'Someone' });
  await expect(status).toHaveText('This is not a SwasthID Health Vault file.');
  await choose(page, { resourceType: 'Bundle', meta: { profile: 'SwasthID Health Summary' }, swasthid: { version: 2 } });
  await expect(status).toContainText('made by a newer version of SwasthID');
  await expect(status).toHaveClass(/is-error/);
  await expect(page.locator('#restoreHealthPanel')).toBeHidden();
  expect(await page.evaluate(() => patientData.name)).toBe('Riya Sen');
});
