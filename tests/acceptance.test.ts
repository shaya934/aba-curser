import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { db } from '../src/lib/db';
import { cleanup } from './helpers';
const base = process.env.APP_ORIGIN || 'http://localhost:3000';
async function signIn(email: string, password: string) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return r.headers.get('set-cookie')!.split(';')[0];
}
async function call(cookie: string, path: string, method = 'GET', body?: unknown) {
  return fetch(base + '/api/' + path, {
    method,
    headers: { cookie, origin: base, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function ok(cookie: string, path: string, method = 'GET', body?: unknown) {
  const r = await call(cookie, path, method, body);
  assert(r.ok, `${method} ${path}: ${r.status} ${await r.clone().text()}`);
  return r.json();
}
after(() => db.$disconnect());
test('full HTTP acceptance: admin → client/staff/assignments → BCBA goals → schedule → therapist data → private PDF', async () => {
  const suffix = crypto.randomUUID();
  const password = 'Synthetic-acceptance-password-123!';
  const adminCookie = await signIn('admin@example.test', process.env.SEED_PASSWORD!);
  const bcba = await db.user.findUniqueOrThrow({ where: { email: 'bcba@example.test' } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });
  const c = await ok(adminCookie, 'clients', 'POST', {
    name: 'Synthetic Acceptance Client',
    clientCode: 'ACCEPT-' + suffix,
    dob: '2018-01-01',
    guardians: 'Synthetic Guardian',
    contact: 'test@example.test',
  });
  let goal: any;
  const staffIds: string[] = [];
  try {
    const rbt = await ok(adminCookie, 'staff', 'POST', {
      name: 'Synthetic Acceptance Therapist',
      email: `therapist-${suffix}@example.test`,
      role: 'RBT',
      password,
      certification: 'SYNTHETIC-CERT',
    });
    staffIds.push(rbt.id);
    const outsider = await ok(adminCookie, 'staff', 'POST', {
      name: 'Synthetic Unauthorized Therapist',
      email: `outsider-${suffix}@example.test`,
      role: 'RBT',
      password,
    });
    staffIds.push(outsider.id);
    for (const userId of [rbt.id, bcba.id])
      await ok(adminCookie, `clients/${c.id}/assignments`, 'POST', { userId });
    const bcbaCookie = await signIn('bcba@example.test', process.env.SEED_PASSWORD!);
    goal = await ok(bcbaCookie, 'goals', 'POST', {
      clientId: c.id,
      name: 'Synthetic functional communication',
      domain: 'Communication',
      startDate: '2026-10-23',
      masteryCriteria: '80% across 3 sessions',
    });
    const targets: any = {};
    for (const measurement of [
      'Correct/Incorrect',
      'Independent/Prompted',
      'Frequency',
      'Duration',
      'Percentage',
      'Yes/No',
    ])
      targets[measurement] = await ok(bcbaCookie, `goals/${goal.id}/targets`, 'POST', {
        name: 'Synthetic ' + measurement,
        measurement,
        masteryCriteria: 'Synthetic criterion',
      });
    const appointments = await ok(adminCookie, 'appointments', 'POST', {
      clientId: c.id,
      therapistId: rbt.id,
      start: '2028-04-03T09:00',
      end: '2028-04-03T10:00',
      timezone: 'America/New_York',
      location: 'Clinic',
    });
    const rbtCookie = await signIn(rbt.email, password);
    const s = await ok(rbtCookie, 'sessions/start', 'POST', { appointmentId: appointments[0].id });
    const entry = async (measurement: string, kind: string, extra: object = {}) =>
      ok(rbtCookie, `sessions/${s.id}/entries`, 'POST', {
        targetId: targets[measurement].id,
        kind,
        idempotencyKey: crypto.randomUUID(),
        ...extra,
      });
    await entry('Correct/Incorrect', 'Correct');
    await entry('Correct/Incorrect', 'Incorrect');
    await entry('Correct/Incorrect', 'Prompted');
    await entry('Independent/Prompted', 'Independent');
    await entry('Frequency', 'Frequency', { value: 2 });
    await entry('Percentage', 'Percentage', { numerator: 3, denominator: 4 });
    await entry('Yes/No', 'Yes');
    await ok(rbtCookie, `sessions/${s.id}/timers`, 'POST', {
      targetId: targets.Duration.id,
      action: 'start',
      idempotencyKey: crypto.randomUUID(),
    });
    await ok(rbtCookie, `sessions/${s.id}/timers`, 'POST', {
      targetId: targets.Duration.id,
      action: 'stop',
      idempotencyKey: crypto.randomUUID(),
    });
    await ok(rbtCookie, `sessions/${s.id}/notes`, 'PATCH', {
      note: 'Synthetic acceptance session: all observations were entered for testing only.',
      observations: 'Synthetic participation and communication activities.',
      noteRevision: 0,
    });
    const done = await ok(rbtCookie, `sessions/${s.id}/finalize`, 'POST', {
      attest: true,
      noteRevision: 1,
    });
    assert.equal(done.status, 'Finalized');
    const persisted = await db.clinicalSession.findUniqueOrThrow({
      where: { id: s.id },
      include: { entries: true, reports: true },
    });
    assert.equal(persisted.entries.length, 8);
    assert.equal(persisted.reports.length, 1);
    assert.equal(persisted.reports[0].status, 'Ready');
    const pdfResponse = await call(rbtCookie, `reports/${persisted.reports[0].id}`);
    assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf');
    const pdf = Buffer.from(await pdfResponse.arrayBuffer());
    const text = execFileSync('pdftotext', ['-', '-'], { input: pdf }).toString();
    for (const expected of [
      '75.00%',
      'Synthetic Acceptance Client',
      'Synthetic Acceptance Therapist',
      'Synthetic acceptance session',
      'Prompted',
      'Duration',
      'Frequency',
    ])
      assert(text.includes(expected), expected);
    assert(
      (await ok(rbtCookie, 'reports')).some(
        (r: any) => r.id === persisted.reports[0].id && r.session.clientId === c.id,
      ),
    );
    const outsideCookie = await signIn(outsider.email, password);
    for (const path of [
      `clients/${c.id}`,
      `sessions/${s.id}`,
      `reports/${persisted.reports[0].id}`,
    ])
      assert.equal((await call(outsideCookie, path)).status, 404);
    assert.equal(
      (
        await call(rbtCookie, `targets/${targets.Frequency.id}`, 'PATCH', {
          ...targets.Frequency,
          status: 'Mastered',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call(rbtCookie, `sessions/${s.id}/notes`, 'PATCH', {
          note: 'cannot change signed note',
          observations: '',
          noteRevision: 1,
        })
      ).status,
      409,
    );
    const csrf = await fetch(base + '/api/clients', {
      method: 'POST',
      headers: {
        cookie: adminCookie,
        origin: 'https://attacker.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'forbidden' }),
    });
    assert.equal(csrf.status, 403);
    console.log(
      'Full acceptance persisted 8 entries and verified PDF contents, client linkage, unauthorized denial and signed-note protection.',
    );
  } finally {
    if (goal) {
      const loaded = await db.goal.findUniqueOrThrow({
        where: { id: goal.id },
        include: { targets: true },
      });
      await cleanup({
        admin,
        bcba,
        rbt: admin,
        c,
        goal: loaded,
        appointment: {} as any,
        targets: {},
      });
    } else await db.client.delete({ where: { id: c.id } });
    for (const id of staffIds) await db.user.delete({ where: { id } });
  }
});
