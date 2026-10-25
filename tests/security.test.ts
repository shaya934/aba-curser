import { test, after } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db';
import { profiles } from '../src/lib/profiles';
import { goals } from '../src/lib/goals';
import { rateLimit } from '../src/lib/limits';
import { fixture, cleanup, req } from './helpers';
after(() => db.$disconnect());
test('tenant isolation is enforced by APIs and database relationships', async () => {
  const f = await fixture();
  const org = await db.organization.create({ data: { name: 'Synthetic Other Agency' } });
  const user = await db.user.create({
    data: {
      orgId: org.id,
      name: 'Synthetic Foreign Admin',
      email: crypto.randomUUID() + '@example.test',
      role: 'ADMIN',
      passwordHash: 'not-used',
    },
  });
  try {
    await assert.rejects(profiles(user, ['clients', f.c.id], req('GET')), /not found/);
    await assert.rejects(goals(user, ['goals', f.goal.id], req('GET')), /not found/);
    await assert.rejects(db.assignment.create({ data: { clientId: f.c.id, userId: user.id } }));
    await assert.rejects(
      db.appointment.create({
        data: {
          orgId: f.admin.orgId,
          clientId: f.c.id,
          therapistId: user.id,
          start: new Date(),
          end: new Date(Date.now() + 60000),
          location: 'Clinic',
          timezone: 'UTC',
        },
      }),
    );
    await assert.rejects(
      db.document.create({
        data: {
          orgId: org.id,
          clientId: f.c.id,
          name: 'synthetic.pdf',
          category: 'Other',
          mimeType: 'application/pdf',
          size: 1,
          storageKey: 'unused',
          uploadedBy: user.id,
        },
      }),
    );
  } finally {
    await db.user.delete({ where: { id: user.id } });
    await db.organization.delete({ where: { id: org.id } });
    await cleanup(f);
  }
});
test('rate limits are shared, bounded and reset after expiration', async () => {
  const id = 'test:' + crypto.randomUUID();
  await rateLimit(id, 2, 10000);
  await rateLimit(id, 2, 10000);
  await assert.rejects(rateLimit(id, 2, 10000), /Too many/);
  await db.rateLimit.update({
    where: { key: createHash('sha256').update(id).digest('hex') },
    data: { resetAt: new Date(0) },
  });
  await rateLimit(id, 2, 10000);
});

test('clinical, account and document tables have database row security enabled', async () => {
  const result = await db.$queryRaw<
    { relname: string; relrowsecurity: boolean }[]
  >`SELECT relname::text AS relname,relrowsecurity FROM pg_class JOIN pg_namespace ON pg_namespace.oid=pg_class.relnamespace WHERE nspname='public' AND relname IN ('User','Client','Document','ClinicalSession','AuthSession','StaffInvitation')`;
  assert.equal(result.length, 6);
  assert(result.every((r) => r.relrowsecurity));
});
