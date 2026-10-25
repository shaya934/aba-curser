import { test, expect } from '@playwright/test';
import { db } from '../../src/lib/db';
test('administrator creates therapist setup link and therapist chooses a password', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Work email').fill('admin@example.test');
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  await page.goto('/staff');
  await page.getByRole('button', { name: '+ Add staff' }).click();
  const email = `browser-invite-${Date.now()}@example.test`;
  await page.getByLabel('Full name').fill('Synthetic invitation therapist');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Share the account invitation' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('no email was sent');
  const url = await page.getByLabel('Private setup link').inputValue();
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  try {
    await page.context().clearCookies();
    await page.goto(url);
    await expect(page.getByLabel('New password (at least 12 characters)')).toBeVisible();
    await expect(page).toHaveURL(/accept-invitation$/);
    await page
      .getByLabel('New password (at least 12 characters)')
      .fill('Synthetic browser password');
    await page.getByLabel('Confirm password').fill('Synthetic browser password');
    await page.getByRole('button', { name: 'Set password', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your account is ready.' })).toBeVisible();
    await page.getByRole('link', { name: 'Continue to sign in' }).click();
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Synthetic browser password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
    await page.context().clearCookies();
    await page.goto(url);
    await page.getByLabel('New password (at least 12 characters)').fill('Another browser password');
    await page.getByLabel('Confirm password').fill('Another browser password');
    await page.getByRole('button', { name: 'Set password', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'invalid or expired' })).toContainText(
      'invalid or expired',
    );
  } finally {
    await db.auditLog.deleteMany({ where: { entityId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
