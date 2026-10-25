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
  await page.goto('/clients/' + c.id);
  await page.getByRole('button', { name: 'Goals & Targets', exact: true }).click();
  await expect(page.getByLabel('Client', { exact: true })).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Add from library to this treatment', exact: true })
    .click();
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
  await page.getByRole('button', { name: 'Suggest targets (AI)', exact: true }).click();
  await expect(
    page.getByText('AI suggestions are not connected yet.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate target drafts' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  // Mock only the external AI response; reviewed target persistence uses the real API/DB.
  await page.route('**/api/goals/*/target-suggestions', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'GET'
          ? { configured: true, eligible: true }
          : {
              drafts: [
                {
                  name: 'Synthetic AI draft',
                  description: 'Synthetic editable target definition.',
                  measurement: 'Percentage',
                  masteryCriteria: '4 of 5 opportunities',
                  baseline: '',
                  status: 'Not Started',
                },
                {
                  name: 'Second draft awaiting review',
                  description: 'Another synthetic draft.',
                  measurement: 'Frequency',
                  masteryCriteria: 'Clinician-defined criterion',
                  baseline: '',
                  status: 'Not Started',
                },
              ],
            },
    }),
  );
  await page.getByRole('button', { name: 'Suggest targets (AI)', exact: true }).click();
  await page.getByRole('button', { name: 'Generate target drafts' }).click();
  await page.getByRole('button', { name: 'Edit & review target' }).first().click();
  await page.getByLabel('Target name').fill('BCBA reviewed synthetic target');
  await page.getByLabel('Measurement type').selectOption('Correct/Incorrect');
  await page.getByRole('button', { name: 'Save definition' }).click();
  await expect(page.getByText('BCBA reviewed synthetic target', { exact: true })).toBeVisible();
  await expect(page.getByText('Second draft awaiting review', { exact: true })).toBeVisible();
  const persisted = await (await page.request.get('/api/goals')).json();
  expect(persisted.find((item: any) => item.id === g.id).targets).toHaveLength(1);
});
