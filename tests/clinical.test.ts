import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db';
import { clinical, summarize } from '../src/lib/clinical';
import { fixture, cleanup, req } from './helpers';
after(() => db.$disconnect());
test('session data survives reads, deduplicates retries, tracks timers, corrects entries and finalizes read-only', async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      clinical(f.admin, ['sessions', 'start'], req('POST', { appointmentId: f.appointment.id })),
      /Only the assigned/,
    );
    const start = () =>
      clinical(f.rbt, ['sessions', 'start'], req('POST', { appointmentId: f.appointment.id }));
    const s = await (await start())!.json();
    assert.equal((await (await start())!.json()).id, s.id);
    const entry = {
      targetId: f.targets['Correct/Incorrect'].id,
      kind: 'Correct',
      idempotencyKey: crypto.randomUUID(),
    };
    const first = await (await clinical(
      f.rbt,
      ['sessions', s.id, 'entries'],
      req('POST', entry),
    ))!.json();
    const second = await (await clinical(
      f.rbt,
      ['sessions', s.id, 'entries'],
      req('POST', entry),
    ))!.json();
    assert.equal(first.id, second.id);
    await assert.rejects(
      clinical(f.rbt, ['sessions', s.id, 'entries'], req('POST', { ...entry, kind: 'Incorrect' })),
      /different data/,
    );
    await assert.rejects(
      clinical(
        f.rbt,
        ['sessions', s.id, 'entries'],
        req('POST', { ...entry, idempotencyKey: crypto.randomUUID(), kind: 'Frequency' }),
      ),
      /does not match/,
    );
    await clinical(
      f.rbt,
      ['sessions', s.id, 'entries'],
      req('POST', {
        targetId: f.targets['Frequency'].id,
        kind: 'Frequency',
        value: 3,
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    await clinical(
      f.rbt,
      ['sessions', s.id, 'entries'],
      req('POST', {
        targetId: f.targets['Percentage'].id,
        kind: 'Percentage',
        numerator: 3,
        denominator: 4,
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    const timer = {
      targetId: f.targets['Duration'].id,
      action: 'start',
      idempotencyKey: crypto.randomUUID(),
    };
    await clinical(f.rbt, ['sessions', s.id, 'timers'], req('POST', timer));
    await db.sessionTimer.updateMany({
      where: { sessionId: s.id },
      data: { startedAt: new Date(Date.now() - 12000) },
    });
    let read = await (await clinical(f.rbt, ['sessions', s.id], req('GET')))!.json();
    assert.equal(read.timers.length, 1);
    await clinical(
      f.rbt,
      ['sessions', s.id, 'notes'],
      req('PATCH', {
        note: 'Synthetic session note: test-only recorded activities.',
        observations: 'Synthetic observations entered for test.',
        noteRevision: 0,
      }),
    );
    await assert.rejects(
      clinical(
        f.rbt,
        ['sessions', s.id, 'notes'],
        req('PATCH', {
          note: 'Stale note should not overwrite',
          observations: '',
          noteRevision: 0,
        }),
      ),
      /another window/,
    );
    await assert.rejects(
      clinical(
        f.rbt,
        ['sessions', s.id, 'finalize'],
        req('POST', { attest: true, noteRevision: 1 }),
      ),
      /Stop all/,
    );
    await db.target.update({
      where: { id: f.targets['Duration'].id },
      data: { status: 'On Hold' },
    });
    const stop = { ...timer, action: 'stop', idempotencyKey: crypto.randomUUID() };
    const duration = await (await clinical(
      f.rbt,
      ['sessions', s.id, 'timers'],
      req('POST', stop),
    ))!.json();
    assert(duration.durationMs >= 12000);
    assert.equal(duration.targetSnapshot.status, 'Active');
    assert.equal(
      (await (await clinical(f.rbt, ['sessions', s.id, 'timers'], req('POST', stop)))!.json()).id,
      duration.id,
    );
    read = await (await clinical(f.rbt, ['sessions', s.id], req('GET')))!.json();
    assert.equal(read.summary.frequency, 3);
    assert.equal(read.summary.percent, 75);
    assert.equal(read.summary.trialPercent, 100);
    await clinical(f.rbt, ['sessions', s.id, 'entries', first.id], req('DELETE'));
    assert.equal(summarize(await db.dataEntry.findMany({ where: { sessionId: s.id } })).trials, 0);
    const done = await (await clinical(
      f.rbt,
      ['sessions', s.id, 'finalize'],
      req('POST', { attest: true, noteRevision: 1 }),
    ))!.json();
    assert.equal(done.status, 'Finalized');
    assert.equal(await db.pdfReport.count({ where: { sessionId: s.id } }), 1);
    await assert.rejects(
      clinical(
        f.rbt,
        ['sessions', s.id, 'entries'],
        req('POST', { ...entry, idempotencyKey: crypto.randomUUID() }),
      ),
      /read-only/,
    );
    const snapshot = (await db.pdfReport.findFirstOrThrow({ where: { sessionId: s.id } }))
      .snapshot as any;
    assert.equal(snapshot.summary.percent, 75);
    assert.equal(snapshot.entries.length, 3);
  } finally {
    await cleanup(f);
  }
});
test('supervisor review is required when configured and amendments preserve signed records', async () => {
  const f = await fixture();
  try {
    await db.organization.update({ where: { id: f.admin.orgId }, data: { requireApproval: true } });
    const s = await (await clinical(
      f.rbt,
      ['sessions', 'start'],
      req('POST', { appointmentId: f.appointment.id }),
    ))!.json();
    await clinical(
      f.rbt,
      ['sessions', s.id, 'entries'],
      req('POST', {
        targetId: f.targets['Yes/No'].id,
        kind: 'Yes',
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    await clinical(
      f.rbt,
      ['sessions', s.id, 'notes'],
      req('PATCH', {
        note: 'Synthetic review note for test only.',
        observations: '',
        noteRevision: 0,
      }),
    );
    const submitted = await (await clinical(
      f.rbt,
      ['sessions', s.id, 'finalize'],
      req('POST', { attest: true, noteRevision: 1 }),
    ))!.json();
    assert.equal(submitted.status, 'Submitted');
    assert.equal(await db.pdfReport.count({ where: { sessionId: s.id } }), 0);
    await assert.rejects(
      clinical(f.rbt, ['sessions', s.id, 'approve'], req('POST', {})),
      /permission/,
    );
    const approved = await (await clinical(
      f.bcba,
      ['sessions', s.id, 'approve'],
      req('POST', {}),
    ))!.json();
    assert.equal(approved.status, 'Finalized');
    await clinical(
      f.bcba,
      ['sessions', s.id, 'amendments'],
      req('POST', {
        version: 1,
        reason: 'Synthetic correction reason',
        note: 'Synthetic amended note with clarification.',
      }),
    );
    assert.equal(await db.pdfReport.count({ where: { sessionId: s.id } }), 2);
    assert.equal(
      (await db.clinicalSession.findUniqueOrThrow({ where: { id: s.id } })).note,
      'Synthetic review note for test only.',
    );
  } finally {
    await db.organization.update({
      where: { id: f.admin.orgId },
      data: { requireApproval: false },
    });
    await cleanup(f);
  }
});
