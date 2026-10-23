import { db } from '../src/lib/db';
import { removeStored } from '../src/lib/storage';
export const req = (method: string, data?: unknown) =>
  new Request('http://localhost/api', { method, body: data ? JSON.stringify(data) : undefined });
export async function fixture() {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });
  const bcba = await db.user.findUniqueOrThrow({ where: { email: 'bcba@example.test' } });
  const rbt = await db.user.findUniqueOrThrow({ where: { email: 'rbt@example.test' } });
  const c = await db.client.create({
    data: {
      orgId: admin.orgId,
      name: 'Synthetic Session Client',
      dob: '2018-01-01',
      clientCode: 'SESSION-' + crypto.randomUUID(),
      assignments: { create: [{ userId: rbt.id }, { userId: bcba.id }] },
    },
  });
  const goal = await db.goal.create({
    data: {
      orgId: admin.orgId,
      clientId: c.id,
      name: 'Synthetic Communication',
      domain: 'Communication',
      startDate: '2026-01-01',
      masteryCriteria: '80% across 3 sessions',
      targets: {
        create: [
          'Correct/Incorrect',
          'Independent/Prompted',
          'Frequency',
          'Duration',
          'Percentage',
          'Yes/No',
        ].map((measurement) => ({
          name: 'Synthetic ' + measurement,
          measurement,
          masteryCriteria: 'Synthetic criterion',
        })),
      },
    },
    include: { targets: true },
  });
  const appointment = await db.appointment.create({
    data: {
      orgId: admin.orgId,
      clientId: c.id,
      therapistId: rbt.id,
      start: new Date(),
      end: new Date(Date.now() + 3600000),
      timezone: 'America/New_York',
      location: 'Clinic',
    },
  });
  return {
    admin,
    bcba,
    rbt,
    c,
    goal,
    appointment,
    targets: Object.fromEntries(goal.targets.map((t) => [t.measurement, t])),
  };
}
export async function cleanup(f: Awaited<ReturnType<typeof fixture>>) {
  const sessions = await db.clinicalSession.findMany({ where: { clientId: f.c.id } });
  const ids = sessions.map((s) => s.id);
  for (const r of await db.pdfReport.findMany({ where: { sessionId: { in: ids } } }))
    if (r.storageKey) await removeStored(r.storageKey);
  await db.pdfReport.deleteMany({ where: { sessionId: { in: ids } } });
  await db.amendment.deleteMany({ where: { sessionId: { in: ids } } });
  await db.sessionTimer.deleteMany({ where: { sessionId: { in: ids } } });
  await db.dataEntry.deleteMany({ where: { sessionId: { in: ids } } });
  await db.clinicalSession.deleteMany({ where: { clientId: f.c.id } });
  await db.appointment.deleteMany({ where: { clientId: f.c.id } });
  await db.clinicalHistory.deleteMany({
    where: { entityId: { in: [f.goal.id, ...f.goal.targets.map((t) => t.id)] } },
  });
  await db.target.deleteMany({ where: { goalId: f.goal.id } });
  await db.goal.delete({ where: { id: f.goal.id } });
  await db.client.delete({ where: { id: f.c.id } });
}
