import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { suggestTargets, suggestionMessages, sourceTemplate } from '../src/lib/target-suggestions';
import { goalBank } from '../src/lib/goal-bank';
import { goals } from '../src/lib/goals';
import { db } from '../src/lib/db';
import { fixture, cleanup, req } from './helpers';
after(() => db.$disconnect());
const draft = {
  name: 'Request an item',
  description: 'During a defined opportunity, request one preferred item.',
  measurement: 'Percentage',
  masteryCriteria: '4 of 5 defined opportunities across three sessions',
};
test('suggestions are disabled until explicitly enabled and use only known library content', async () => {
  const old = process.env.LLM_TARGETS_ENABLED;
  try {
    delete process.env.LLM_TARGETS_ENABLED;
    await assert.rejects(suggestTargets(goalBank[0]), /not configured/);
  } finally {
    if (old === undefined) delete process.env.LLM_TARGETS_ENABLED;
    else process.env.LLM_TARGETS_ENABLED = old;
  }
  assert.equal(sourceTemplate('Source: ABA-0001 · Acquisition')?.id, 'ABA-0001');
  assert.equal(sourceTemplate('Custom client note'), undefined);
  const body = JSON.parse(suggestionMessages(goalBank[0])[1].content);
  assert.equal(body.templateId, 'ABA-0001');
  assert(!('clientId' in body));
  assert(!('clientName' in body));
  assert(!('sessionNotes' in body));
});
test('AI output is validated and remains unsaved until an authorized clinician reviews and creates a target', async () => {
  const f = await fixture();
  const originalFetch = global.fetch;
  const oldKey = process.env.LLM_API_KEY,
    oldFlag = process.env.LLM_TARGETS_ENABLED;
  let calls = 0;
  try {
    await db.goal.update({
      where: { id: f.goal.id },
      data: {
        description: 'Source: ABA-0001 · Acquisition\nPrivate client details must never be sent.',
      },
    });
    process.env.LLM_API_KEY = 'synthetic-test';
    process.env.LLM_TARGETS_ENABLED = 'true';
    global.fetch = async (_url, init) => {
      calls++;
      const payload = JSON.parse(String(init?.body));
      assert(!JSON.stringify(payload).includes('Private client details'));
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ targets: [draft] }) } }],
      });
    };
    await assert.rejects(
      goals(f.rbt, ['goals', f.goal.id, 'target-suggestions'], req('POST', {})),
      /permission/,
    );
    assert.equal(calls, 0);
    const before = await db.target.count({ where: { goalId: f.goal.id } });
    const result = await (await goals(
      f.bcba,
      ['goals', f.goal.id, 'target-suggestions'],
      req('POST', {}),
    ))!.json();
    assert.equal(calls, 1);
    assert.equal(result.drafts[0].status, 'Not Started');
    assert.equal(result.drafts[0].baseline, '');
    assert.equal(await db.target.count({ where: { goalId: f.goal.id } }), before);
    const edited = await (await goals(
      f.bcba,
      ['goals', f.goal.id, 'targets'],
      req('POST', {
        ...result.drafts[0],
        name: 'BCBA revised target',
        measurement: 'Correct/Incorrect',
      }),
    ))!.json();
    f.goal.targets.push(edited);
    assert.equal(edited.name, 'BCBA revised target');
    assert.equal(edited.measurement, 'Correct/Incorrect');
    assert.equal(edited.status, 'Not Started');
    global.fetch = async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ targets: [{ ...draft, measurement: 'Unsupported' }] }),
            },
          },
        ],
      });
    await assert.rejects(suggestTargets(goalBank[0]), /invalid target suggestions/);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = oldKey;
    if (oldFlag === undefined) delete process.env.LLM_TARGETS_ENABLED;
    else process.env.LLM_TARGETS_ENABLED = oldFlag;
    await cleanup(f);
  }
});
