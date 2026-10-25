import { test, expect } from '@playwright/test';
test('sign in and navigate profiles and calendar on desktop and mobile', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Work email').fill('admin@example.test');
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  for (const [url, name] of [
    ['/clients', 'Clients'],
    ['/staff', 'Care team'],
    ['/schedule', 'Schedule'],
  ]) {
    await page.goto(url);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(page.locator('.calendar-cell')).toHaveCount(42);
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await expect(page.locator('.calendar-cell')).toHaveCount(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});
