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
    oldFlag = process.env.LLM_TARGETS_ENABLED,
    oldProvider = process.env.LLM_PROVIDER;
  let calls = 0;
  try {
    await db.goal.update({
      where: { id: f.goal.id },
      data: {
        description: 'Source: ABA-0001 · Acquisition\nPrivate client details must never be sent.',
      },
    });
    delete process.env.LLM_PROVIDER;
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
    if (oldProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = oldProvider;
    await cleanup(f);
  }
});

test('Gemini uses a separate key, native structured output and generic templates with no provider fallback', async () => {
  const originalFetch = global.fetch;
  const keys = [
    'LLM_TARGETS_ENABLED',
    'LLM_PROVIDER',
    'LLM_API_KEY',
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
  ] as const;
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  let calls = 0;
  try {
    process.env.LLM_TARGETS_ENABLED = 'true';
    process.env.LLM_PROVIDER = 'gemini';
    process.env.LLM_API_KEY = 'unrelated-openai-key';
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    global.fetch = async () => {
      calls++;
      throw Error('Must not call provider');
    };
    await assert.rejects(suggestTargets(goalBank[0]), /not configured/);
    assert.equal(calls, 0);
    process.env.GEMINI_API_KEY = 'synthetic-gemini-key';
    global.fetch = async (url, init) => {
      calls++;
      assert.equal(
        String(url),
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      );
      assert(!String(url).includes(process.env.GEMINI_API_KEY!));
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('x-goog-api-key'), 'synthetic-gemini-key');
      assert.equal(headers.get('authorization'), null);
      const body = JSON.parse(String(init?.body));
      const template = JSON.parse(body.contents[0].parts[0].text);
      assert.equal(template.templateId, 'ABA-0001');
      assert.deepEqual(
        Object.keys(template).sort(),
        [
          'templateId',
          'domain',
          'skill',
          'stage',
          'goal',
          'masteryCriteria',
          'measurementGuidance',
          'promptGuidance',
          'clinicalNotes',
          'supportedMeasurements',
        ].sort(),
      );
      assert(body.systemInstruction.parts[0].text.includes('BCBA review'));
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.equal(body.generationConfig.responseSchema.properties.targets.maxItems, 5);
      assert(!JSON.stringify(body).includes('unrelated-openai-key'));
      return Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                { thought: true, text: 'do not expose reasoning' },
                { text: JSON.stringify({ targets: [draft] }) },
              ],
            },
          },
        ],
      });
    };
    const drafts = await suggestTargets(goalBank[0]);
    assert.equal(calls, 1);
    assert.deepEqual(drafts, [{ ...draft, status: 'Not Started', baseline: '' }]);
    for (const candidates of [
      [],
      [{ finishReason: 'SAFETY' }],
      [
        {
          finishReason: 'MAX_TOKENS',
          content: { parts: [{ text: JSON.stringify({ targets: [draft] }) }] },
        },
      ],
      [
        {
          finishReason: 'STOP',
          content: {
            parts: [{ text: JSON.stringify({ targets: [{ ...draft, baseline: 'invented' }] }) }],
          },
        },
      ],
      [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: JSON.stringify({ targets: Array(6).fill(draft) }) }] },
        },
      ],
    ]) {
      global.fetch = async () => Response.json({ candidates });
      await assert.rejects(suggestTargets(goalBank[0]), /invalid target suggestions/);
    }
    for (const [status, pattern] of [
      [429, /usage limit/],
      [403, /rejected the connection/],
      [500, /could not generate/],
    ] as const) {
      let attempts = 0;
      global.fetch = async () => {
        attempts++;
        return Response.json(
          { error: { message: 'must not leak sensitive provider text' } },
          { status },
        );
      };
      await assert.rejects(suggestTargets(goalBank[0]), pattern);
      assert.equal(attempts, 1);
    }
    global.fetch = async () => {
      throw new DOMException('private details', 'TimeoutError');
    };
    await assert.rejects(suggestTargets(goalBank[0]), /could not be reached/);
    process.env.GEMINI_MODEL = '../unsupported';
    await assert.rejects(suggestTargets(goalBank[0]), /model setting is invalid/);
    process.env.LLM_PROVIDER = 'unknown';
    await assert.rejects(suggestTargets(goalBank[0]), /not configured/);
  } finally {
    global.fetch = originalFetch;
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
});
