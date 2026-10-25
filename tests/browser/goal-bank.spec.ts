import { test, expect } from '@playwright/test';
test('browse spreadsheet bank and review/edit a template before saving to a client', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Work email').fill('admin@example.test');
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  const r = await page.request.post('/api/clients', {
    headers: { origin: 'http://localhost:3000' },
    data: { name: 'Synthetic Bank Client', clientCode: 'BANK-' + Date.now(), dob: '2018-01-01' },
  });
  expect(r.ok()).toBeTruthy();
  const c = await r.json();
  await page.goto('/goals');
  await page.getByLabel('Client', { exact: true }).selectOption(c.id);
  await page.getByRole('button', { name: /Browse goal bank/ }).click();
  await expect(page.getByRole('status')).toContainText('2000 matching');
  await page.getByLabel('Search goal bank').fill('ABA-1001');
  await expect(page.getByRole('status')).toContainText('1 matching');
  await page.getByRole('button', { name: 'Review template', exact: true }).click();
  await expect(page.getByLabel('Description')).toHaveValue(/ABA-1001/);
  await page.getByLabel('Goal name').fill('Clinician reviewed synthetic request');
  await page.getByRole('button', { name: 'Save definition' }).click();
  await expect(
    page.getByRole('heading', { name: 'Clinician reviewed synthetic request' }),
  ).toBeVisible();
  const goals = await (await page.request.get('/api/goals')).json();
  const g = goals.find((g: any) => g.clientId === c.id);
  expect(g.status).toBe('Not Started');
  expect(g.targets).toHaveLength(0);
  expect(g.description).toContain('Percent of opportunities');
});
