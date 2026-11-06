import { test, expect } from '@playwright/test';

const roles = [
  ['patient', 'OB-2026-0001', 'Patient or caregiver ID'],
  ['doctor', 'DOC-0001', 'Doctor ID'],
  ['staff', 'STF-0002', 'Staff ID'],
];

for (const [portal, id, label] of roles) {
  test(`${portal}: sign-in and responsive care workspace`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.log('BROWSER ERROR:', error.message); });
    page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(`/${portal}`);
    await page.getByLabel(label, { exact: true }).fill(id);
    await page.getByLabel('Password', { exact: true }).fill('OncoDemo!2026');
    await page.getByRole('button', { name: `Enter ${portal} workspace`, exact: true }).click();
    await expect(page.locator('.care-app')).toBeVisible();
    await expect(page.locator('.care-loading')).toHaveCount(0);
    for (const width of [320, 390, 540, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
      await expect(page.locator('main')).toBeVisible();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
    const tabs = await nav.getByRole('button').allTextContents();
    for (const tab of tabs) {
      console.log(portal, tab);
      await nav.getByRole('button', { name: tab.trim(), exact: true }).click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.care-error').filter({ visible: true })).toHaveCount(0);
      await page.setViewportSize({ width: 320, height: 850 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { message: `${portal} ${tab} overflows at 320px` }).toBeTruthy().catch(async error => { console.log(await page.evaluate(() => [...document.querySelectorAll("main *")].map(el => ({tag: el.tagName, cls: String(el.className), right: Math.round(el.getBoundingClientRect().right), width: Math.round(el.getBoundingClientRect().width)})).filter(el => el.right > innerWidth + 1).slice(0,25))); throw error; });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    expect(errors).toEqual([]);
  });
}
