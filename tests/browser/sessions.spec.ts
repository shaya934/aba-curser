import { test, expect } from '@playwright/test';
import { fixture, cleanup } from '../helpers';
import { db } from '../../src/lib/db';
test('therapist records trials, preserves notes and timers on reload, and finalizes', async ({
  page,
}) => {
  const f = await fixture();
  try {
    await page.goto('/login');
    await page.getByLabel('Work email').fill('rbt@example.test');
    await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
    await page.goto('/sessions?start=' + f.appointment.id);
    await expect(page.getByRole('heading', { name: f.c.name, exact: true })).toBeVisible();
    const session = await db.clinicalSession.findUniqueOrThrow({
      where: { appointmentId: f.appointment.id },
    });
    await page.getByRole('button', { name: '+ Correct', exact: true }).click();
    await expect
      .poll(() => db.dataEntry.count({ where: { sessionId: session.id, kind: 'Correct' } }))
      .toBe(1);
    await page.getByRole('button', { name: '+ Count event', exact: true }).click();
    await expect
      .poll(() => db.dataEntry.count({ where: { sessionId: session.id, kind: 'Frequency' } }))
      .toBe(1);
    await page
      .getByLabel('Therapist note')
      .fill('Synthetic browser test: participation and activities recorded accurately.');
    await expect
      .poll(
        async () =>
          (await db.clinicalSession.findUniqueOrThrow({ where: { id: session.id } })).note,
      )
      .toContain('Synthetic browser');
    await page.reload();
    await expect(page.getByLabel('Therapist note')).toHaveValue(
      'Synthetic browser test: participation and activities recorded accurately.',
    );
    await page.getByRole('button', { name: '▶ Start timer' }).click();
    await expect(page.getByRole('button', { name: '■ Stop timer' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: '■ Stop timer' })).toBeVisible();
    await page.getByRole('button', { name: '■ Stop timer' }).click();
    await expect(page.getByRole('button', { name: '▶ Start timer' })).toBeVisible();
    await page.getByRole('button', { name: 'Review & complete session →' }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Attest & complete session' }).click();
    await expect(page.getByText('Finalized', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Therapist note')).toHaveAttribute('readonly', '');
    await expect.poll(() => db.pdfReport.count({ where: { sessionId: session.id } })).toBe(1);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download PDF ↓', exact: true }).click();
    const download = await downloadPromise;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toContain(session.id);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
  } finally {
    await cleanup(f);
  }
});
test.afterAll(() => db.$disconnect());
