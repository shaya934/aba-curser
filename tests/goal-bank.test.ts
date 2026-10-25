import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalBank, searchGoalBank } from '../src/lib/goal-bank';
import { draftFromTemplate } from '../src/lib/goal-template';
import { goals } from '../src/lib/goals';
test('workbook imports all 2000 unique goals and preserves all nine source fields', () => {
  assert.equal(goalBank.length, 2000);
  assert.equal(new Set(goalBank.map((e) => e.id)).size, 2000);
  assert.equal(new Set(goalBank.map((e) => e.domain)).size, 40);
  for (const e of goalBank)
    assert(Object.values(e).every((v) => typeof v === 'string' && v.length > 0));
  assert.equal(goalBank[0].id, 'ABA-0001');
  assert.equal(goalBank.at(-1)!.id, 'ABA-2000');
  assert.equal(goalBank[0].measurement, 'Opportunity-based %');
  assert.equal(goalBank[999].id, 'ABA-1000');
  assert.equal(goalBank[1000].id, 'ABA-1001');
  assert.equal(goalBank[1000].measurement, 'Percent of opportunities');
  assert.equal(searchGoalBank({ q: 'ABA-2000' }).total, 1);
});
test('bank search filters domains and levels, pages consistently, and drafts retain guidance', () => {
  const all = searchGoalBank({});
  assert.equal(all.total, 2000);
  assert.equal(all.items.length, 20);
  assert.equal(searchGoalBank({ page: 2 }).items[0].id, 'ABA-0021');
  const result = searchGoalBank({ q: 'ABA-0001' });
  assert.equal(result.total, 1);
  const entry = result.items[0];
  assert(
    searchGoalBank({ domain: entry.domain, level: entry.level }).items.every(
      (e) => e.domain === entry.domain && e.level === entry.level,
    ),
  );
  assert.equal(searchGoalBank({ q: 'nonexistent-invented-term' }).total, 0);
  const draft = draftFromTemplate(entry, 'client', '2026-10-25');
  assert.equal(draft.status, 'Not Started');
  assert.equal(draft.masteryCriteria, entry.masteryCriteria);
  assert(draft.description.includes(entry.clinicalNotes));
  assert(draft.description.includes(entry.promptExpectation));
  assert(draft.description.includes(entry.measurement));
  assert(draft.description.includes(entry.id));
});
test('RBTs cannot read the bank API; clinicians can search without exposing client data', async () => {
  const actor = {
    id: 'test',
    orgId: 'test',
    name: 'Synthetic',
    email: 'test@example.test',
    role: 'RBT' as const,
  };
  await assert.rejects(
    goals(actor, ['goal-bank'], new Request('http://localhost/api/goal-bank')),
    /permission/,
  );
  const response = await goals(
    { ...actor, role: 'BCBA' },
    ['goal-bank'],
    new Request('http://localhost/api/goal-bank?q=ABA-0001'),
  );
  assert.equal((await response!.json()).total, 1);
});
