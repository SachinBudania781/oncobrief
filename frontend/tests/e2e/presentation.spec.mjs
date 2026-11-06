import { test, expect } from '@playwright/test';

test('mobile reminders, report filters and feature navigation remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('oncobrief-dose-reminders:OB-2026-0001', 'on'));
  let medicinesFixture;
  await page.route('**/api/patients/OB-2026-0001/medications', async route => {
    medicinesFixture ||= route.fetch().then(response => response.json());
    const medicines = structuredClone(await medicinesFixture);
    // Use the real disposable fixture with one dose due now; never change its prescription.
    if (medicines.length) medicines[0].today = [{
      ...(medicines[0].today?.[0] || {}), time: '12:00', status: 'due',
      scheduled_at: new Date(Date.now() - 60000).toISOString(),
    }];
    await route.fulfill({ json: medicines });
  });
  await page.goto('/patient');
  await page.getByLabel('Patient or caregiver ID', { exact: true }).fill('OB-2026-0001');
  await page.getByLabel('Password', { exact: true }).fill('OncoDemo!2026');
  await page.getByRole('button', { name: 'Enter patient workspace', exact: true }).click();
  const reminder = page.locator('.care-dose-reminder');
  await expect(reminder).toBeVisible();
  await reminder.getByRole('button', { name: 'View medicines', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('Medicines & requests');
  await expect(reminder).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await page.reload();
  await expect(page.locator('main h1')).toHaveText('Medicines & requests');
  await expect(page.locator('.care-loading')).toHaveCount(0);
  await expect(reminder).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'More', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Your workspace', exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Reports & uploads', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('main h1')).toHaveText('Reports & uploads');
  await expect(page.locator('.records-mobile-card').first()).toBeVisible();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const filters = page.getByRole('dialog', { name: 'Filter reports', exact: true });
  await filters.getByRole('combobox', { name: 'Type', exact: true }).selectOption({ index: 1 });
  await filters.getByRole('button', { name: 'Show reports', exact: true }).click();
  await expect(filters).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear filters', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear filters', exact: true })).toHaveCount(0);

  await page.keyboard.press('Control+k');
  const finder = page.getByRole('dialog', { name: 'Find a feature', exact: true });
  await expect(finder).toBeVisible();
  await expect(page.getByLabel('Search features', { exact: true })).toBeFocused();
  await page.getByLabel('Search features', { exact: true }).fill('medicine');
  await finder.getByRole('button', { name: 'Medicines & requests', exact: true }).click();
  await expect(finder).toHaveCount(0);
  await expect(page.locator('main h1')).toHaveText('Medicines & requests');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.unrouteAll({ behavior: 'wait' });
});
