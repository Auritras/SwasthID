const { test, expect, openApp } = require('./fixtures');

const MEDS = [
  { name: 'Metformin', dose: '500 mg', schedule: 'Twice daily', times: ['08:00', '20:00'] },
  { name: 'Amlodipine', dose: '5 mg', schedule: 'Once daily', times: ['09:00'] },
];

test('marking a dose as taken updates today\'s count', async ({ page, errors }) => {
  await openApp(page, { medications: MEDS });
  await expect(page.locator('#doseSummaryText')).toHaveText('0 of 3 taken');
  await page.locator('#todayMedList [data-mark-med]').first().click();
  await expect(page.locator('#doseSummaryText')).toHaveText('1 of 3 taken');
  await expect(page.locator('#todayMedList [data-mark-med]').first()).toHaveText(/^Taken/);
  expect(errors).toEqual([]);
});

test('Find medicines lists results and links to each pharmacy\'s search', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => showTab('order'));
  await page.fill('#medSearch', 'metformin');
  await page.click('#searchBtn');
  const first = page.locator('#priceList .med-result').first();
  await expect(first).toContainText(/Metformin/i);
  await first.getByRole('button', { name: /where to buy/i }).click();
  const links = page.locator('#priceList .rx-pharmacy-options a');
  await expect(links).toHaveCount(5);
  await expect(links.filter({ hasText: 'Tata 1mg' })).toHaveAttribute('href', /^https:\/\/www\.1mg\.com\/search\/all\?name=Metformin/);
  await expect(links.filter({ hasText: 'PharmEasy' })).toHaveAttribute('href', /^https:\/\/pharmeasy\.in\/search\/all\?name=Metformin/);
  await expect(links.filter({ hasText: 'Apollo Pharmacy' })).toHaveAttribute('href', /^https:\/\/www\.apollopharmacy\.in\/search-medicines\/Metformin/);
  await expect(links.first()).toHaveAttribute('rel', /noopener/);
});
