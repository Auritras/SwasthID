const fs = require('fs');
const zlib = require('zlib');
const { test, expect, openApp } = require('./fixtures');

// The PDFs are compressed, so inflate each content stream to read the text.
function pdfText(bytes) {
  const raw = bytes.toString('latin1');
  let text = '';
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { text += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch (_) { text += m[1]; }
  }
  return text;
}

const PROFILE = {
  dob: '1984-05-04', bloodGroup: 'B+', allergies: ['Penicillin'],
  conditions: [{ name: 'Hypertension', status: 'Ongoing', year: '2015' }],
  medications: [{ name: 'Amlodipine', dose: '5 mg', schedule: 'Once daily', times: ['08:00'] }],
  emergencyContact: { name: 'Arjun Sen', relation: 'Son', phone: '+91 98300 00000' },
};

async function download(page, trigger) {
  const [file] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const bytes = fs.readFileSync(await file.path());
  return { name: file.suggestedFilename(), bytes };
}

test('downloads the emergency card as a PDF', async ({ page, errors }) => {
  await openApp(page, PROFILE);
  await page.evaluate(() => showTab('emergency'));
  const { name, bytes } = await download(page, () => page.click('#downloadEmergencyPdfBtn'));
  expect(name).toBe('SwasthID-Emergency-Riya-Sen.pdf');
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const text = pdfText(bytes);
  for (const expected of ['DRUG ALLERGIES', 'Penicillin', 'Arjun Sen', 'Amlodipine']) expect(text).toContain(expected);
  expect(errors).toEqual([]);
});

test('downloads the health summary as a PDF', async ({ page }) => {
  await openApp(page, PROFILE);
  await page.evaluate(() => showTab('share'));
  const { name, bytes } = await download(page, () => page.click('#exportHealthPdfBtn'));
  expect(name).toBe('SwasthID-Health-Summary-Riya-Sen.pdf');
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const text = pdfText(bytes);
  for (const expected of ['DRUG ALLERGIES', 'Penicillin', 'Amlodipine', 'Hypertension']) expect(text).toContain(expected);
});
