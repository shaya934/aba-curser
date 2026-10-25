import { z } from 'zod';
import { Prisma, type DataEntry } from '@prisma/client';
import { db } from './db';
import { type Actor, roles, requireClient, clientScope, HttpError, audit } from './auth';
import { json, text } from './validation';
import { snapshot } from './goals';
import { lockSchedule } from './scheduling';
export type EntryLike = Pick<
  DataEntry,
  'kind' | 'value' | 'numerator' | 'denominator' | 'durationMs' | 'voidedAt'
>;
export function summarize(entries: EntryLike[]) {
  const active = entries.filter((e) => !e.voidedAt);
  const trials = active.filter((e) =>
    ['Correct', 'Incorrect', 'Prompted', 'Independent', 'Yes', 'No'].includes(e.kind),
  );
  const successes = trials.filter((e) => ['Correct', 'Independent', 'Yes'].includes(e.kind)).length;
  const numerator = active.reduce((n, e) => n + (e.numerator ?? 0), 0),
    denominator = active.reduce((n, e) => n + (e.denominator ?? 0), 0);
  return {
    entries: active.length,
    trials: trials.length,
    correct: successes,
    prompted: trials.filter((e) => e.kind === 'Prompted').length,
    trialPercent: trials.length ? (100 * successes) / trials.length : null,
    frequency: active.filter((e) => e.kind === 'Frequency').reduce((n, e) => n + e.value, 0),
    durationMs: active.reduce((n, e) => n + (e.durationMs ?? 0), 0),
    numerator,
    denominator,
    percent: denominator ? (100 * numerator) / denominator : null,
  };
}
async function lockSession(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`session:${id}`}))`;
}
async function authorizedSession(actor: Actor, id: string, write = false) {
  const s = await db.clinicalSession.findFirst({ where: { id, orgId: actor.orgId } });
  if (!s) throw new HttpError(404, 'Session not found.');
  await requireClient(actor, s.clientId);
  if (write && s.therapistId !== actor.id)
    throw new HttpError(403, 'Only the session therapist can record data.');
  return s;
}
async function activeSession(tx: Prisma.TransactionClient, id: string) {
  await lockSession(tx, id);
  const s = await tx.clinicalSession.findUniqueOrThrow({ where: { id } });
  if (s.status !== 'In Progress')
    throw new HttpError(
      409,
      'This session is read-only. Use an authorized amendment for finalized documentation.',
    );
  return s;
}
async function activeTarget(tx: Prisma.TransactionClient, id: string, clientId: string) {
  const t = await tx.target.findFirst({
    where: { id, status: 'Active', goal: { clientId, status: 'Active' } },
    include: { goal: true },
  });
  if (!t) throw new HttpError(400, 'Target is not active for this client.');
  return t;
}
const entryInput = z.object({
  targetId: z.string().min(1),
  idempotencyKey: z.uuid(),
  kind: z.enum([
    'Correct',
    'Incorrect',
    'Prompted',
    'Independent',
    'Frequency',
    'Percentage',
    'Yes',
    'No',
  ]),
  value: z.number().int().min(1).max(100000).optional(),
  numerator: z.number().int().min(0).max(100000).optional(),
  denominator: z.number().int().min(1).max(100000).optional(),
});
export async function clinical(
  actor: Actor,
  path: string[],
  req: Request,
): Promise<Response | null> {
  const [resource, id, action, entryId] = path;
  const method = req.method;
  if (resource === 'clients' && id && action === 'progress' && method === 'GET') {
    await requireClient(actor, id);
    const sessions = await db.clinicalSession.findMany({
      where: { orgId: actor.orgId, clientId: id },
      include: { entries: true },
      orderBy: { actualStart: 'desc' },
    });
    return Response.json(
      sessions.map((s) => {
        const a = summarize(s.entries);
        return {
          id: s.id,
          actualStart: s.actualStart,
          status: s.status,
          summary: `${a.trials} trials · ${a.frequency} events · ${(a.durationMs / 1000).toFixed(1)} seconds`,
        };
      }),
    );
  }
  if (resource !== 'sessions') return null;
  if (!id && method === 'GET')
    return Response.json(
      await db.clinicalSession.findMany({
        where: { orgId: actor.orgId, client: clientScope(actor) },
        include: {
          client: { select: { name: true } },
          therapist: { select: { name: true } },
          reports: { select: { id: true, version: true, status: true } },
        },
        orderBy: { actualStart: 'desc' },
      }),
    );
  if (id === 'start' && method === 'POST') {
    const { appointmentId } = z.object({ appointmentId: z.string().min(1) }).parse(await json(req));
    const appointment = await db.appointment.findFirst({
      where: { id: appointmentId, orgId: actor.orgId },
    });
    if (!appointment) throw new HttpError(404, 'Appointment not found.');
    await requireClient(actor, appointment.clientId);
    if (actor.id !== appointment.therapistId)
      throw new HttpError(403, 'Only the assigned therapist can start this appointment.');
    const result = await db.$transaction(async (tx) => {
      await lockSchedule(tx, actor.orgId);
      const current = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
      const existing = await tx.clinicalSession.findUnique({ where: { appointmentId } });
      if (existing) return existing;
      if (current.status !== 'Scheduled')
        throw new HttpError(409, 'Only a scheduled appointment can start.');
      if (
        !(await tx.assignment.findUnique({
          where: { clientId_userId: { clientId: current.clientId, userId: current.therapistId } },
        }))
      )
        throw new HttpError(409, 'The therapist is no longer assigned to this client.');
      const session = await tx.clinicalSession.create({
        data: {
          orgId: actor.orgId,
          clientId: current.clientId,
          therapistId: current.therapistId,
          appointmentId,
        },
      });
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: 'In Progress' },
      });
      return session;
    });
    await audit(actor, 'session.start', result.id);
    return Response.json(result, { status: 201 });
  }
  if (!id) throw new HttpError(404, 'Session not found.');
  await authorizedSession(
    actor,
    id,
    method !== 'GET' && !['approve', 'amendments'].includes(action),
  );
  if (method === 'GET') {
    const s = await db.clinicalSession.findUniqueOrThrow({
      where: { id },
      include: {
        client: true,
        therapist: { select: { id: true, name: true, title: true, certification: true } },
        appointment: true,
        entries: { orderBy: { recordedAt: 'asc' } },
        timers: true,
        reports: {
          select: { id: true, version: true, status: true, attempts: true },
          orderBy: { version: 'desc' },
        },
        amendments: { orderBy: { version: 'desc' } },
      },
    });
    const goals = await db.goal.findMany({
      where: { clientId: s.clientId, status: 'Active' },
      include: { targets: { where: { status: 'Active' } } },
    });
    return Response.json({ ...s, goals, summary: summarize(s.entries) });
  }
  if (action === 'notes' && method === 'PATCH') {
    const data = z
      .object({ note: text, observations: text, noteRevision: z.number().int().min(0) })
      .parse(await json(req));
    const result = await db.$transaction(async (tx) => {
      const s = await activeSession(tx, id);
      if (s.noteRevision !== data.noteRevision)
        throw new HttpError(
          409,
          'Notes changed in another window. Copy your changes, refresh, and review before saving.',
        );
      return tx.clinicalSession.update({
        where: { id },
        data: { note: data.note, observations: data.observations, noteRevision: { increment: 1 } },
      });
    });
    await audit(actor, 'session.notes', id);
    return Response.json({ noteRevision: result.noteRevision });
  }
  if (action === 'entries' && method === 'POST') {
    const input = entryInput.parse(await json(req));
    const result = await db.$transaction(async (tx) => {
      const s = await activeSession(tx, id);
      const prior = await tx.dataEntry.findUnique({
        where: {
          sessionId_idempotencyKey: { sessionId: id, idempotencyKey: input.idempotencyKey },
        },
      });
      if (prior) {
        if (
          prior.targetId !== input.targetId ||
          prior.kind !== input.kind ||
          prior.value !==
            (input.kind === 'Percentage'
              ? input.numerator
              : input.kind === 'Frequency'
                ? (input.value ?? 1)
                : 1) ||
          prior.numerator !== (input.numerator ?? null) ||
          prior.denominator !== (input.denominator ?? null)
        )
          throw new HttpError(409, 'This retry key was already used for different data.');
        return prior;
      }
      const t = await activeTarget(tx, input.targetId, s.clientId);
      const allowed: Record<string, string[]> = {
        'Correct/Incorrect': ['Correct', 'Incorrect', 'Prompted'],
        'Independent/Prompted': ['Independent', 'Prompted'],
        Frequency: ['Frequency'],
        Percentage: ['Percentage'],
        'Yes/No': ['Yes', 'No'],
      };
      if (!allowed[t.measurement]?.includes(input.kind))
        throw new HttpError(400, 'Measurement does not match this target.');
      if (
        input.kind === 'Percentage' &&
        (input.numerator === undefined ||
          input.denominator === undefined ||
          input.numerator > input.denominator)
      )
        throw new HttpError(400, 'Enter a numerator no greater than a positive denominator.');
      if (
        input.kind !== 'Percentage' &&
        (input.numerator !== undefined || input.denominator !== undefined)
      )
        throw new HttpError(400, 'Only percentage measurements accept numerator/denominator.');
      return tx.dataEntry.create({
        data: {
          sessionId: id,
          targetId: t.id,
          idempotencyKey: input.idempotencyKey,
          kind: input.kind,
          value:
            input.kind === 'Frequency'
              ? (input.value ?? 1)
              : input.kind === 'Percentage'
                ? input.numerator!
                : 1,
          numerator: input.numerator,
          denominator: input.denominator,
          targetSnapshot: snapshot(t),
        },
      });
    });
    await audit(actor, 'session.entry', result.id);
    return Response.json(result, { status: 201 });
  }
  if (action === 'entries' && entryId && method === 'DELETE') {
    const result = await db.$transaction(async (tx) => {
      await activeSession(tx, id);
      const entry = await tx.dataEntry.findFirst({ where: { id: entryId, sessionId: id } });
      if (!entry) throw new HttpError(404, 'Entry not found.');
      return tx.dataEntry.update({
        where: { id: entryId },
        data: { voidedAt: entry.voidedAt || new Date() },
      });
    });
    await audit(actor, 'session.entry.void', entryId);
    return Response.json(result);
  }
  if (action === 'timers' && method === 'POST') {
    const input = z
      .object({
        targetId: z.string().min(1),
        action: z.enum(['start', 'stop']),
        idempotencyKey: z.uuid(),
      })
      .parse(await json(req));
    const result = await db.$transaction(async (tx) => {
      const s = await activeSession(tx, id);
      const key = { sessionId: id, targetId: input.targetId };
      if (input.action === 'start') {
        const t = await activeTarget(tx, input.targetId, s.clientId);
        if (t.measurement !== 'Duration')
          throw new HttpError(400, 'This target is not a duration measurement.');
        return tx.sessionTimer.upsert({
          where: { sessionId_targetId: key },
          update: {},
          create: { ...key, targetSnapshot: snapshot(t) },
        });
      }
      const prior = await tx.dataEntry.findUnique({
        where: {
          sessionId_idempotencyKey: { sessionId: id, idempotencyKey: input.idempotencyKey },
        },
      });
      if (prior) {
        if (prior.targetId !== input.targetId || prior.kind !== 'Duration')
          throw new HttpError(409, 'Retry key belongs to another entry.');
        return prior;
      }
      const timer = await tx.sessionTimer.findUnique({ where: { sessionId_targetId: key } });
      if (!timer) throw new HttpError(409, 'This timer is not running.');
      const durationMs = Math.min(2147483647, Date.now() - +timer.startedAt);
      const entry = await tx.dataEntry.create({
        data: {
          ...key,
          idempotencyKey: input.idempotencyKey,
          kind: 'Duration',
          value: durationMs / 1000,
          durationMs,
          targetSnapshot: timer.targetSnapshot as Prisma.InputJsonValue,
        },
      });
      await tx.sessionTimer.delete({ where: { id: timer.id } });
      return entry;
    });
    await audit(actor, 'session.timer.' + input.action, id);
    return Response.json(result);
  }
  if (action === 'finalize' && method === 'POST') {
    const input = z
      .object({ attest: z.literal(true), noteRevision: z.number().int().min(0) })
      .parse(await json(req));
    const result = await db.$transaction(async (tx) => {
      await lockSession(tx, id);
      const s = await tx.clinicalSession.findUniqueOrThrow({ where: { id } });
      if (s.status === 'Finalized' || s.status === 'Submitted') return s;
      if (s.noteRevision !== input.noteRevision)
        throw new HttpError(409, 'Save and review your latest notes first.');
      if (s.note.trim().length < 10)
        throw new HttpError(400, 'Enter a factual session note of at least 10 characters.');
      if (!(await tx.dataEntry.count({ where: { sessionId: id, voidedAt: null } })))
        throw new HttpError(400, 'Record at least one measurement before completing this session.');
      if (await tx.sessionTimer.count({ where: { sessionId: id } }))
        throw new HttpError(400, 'Stop all running timers first.');
      const org = await tx.organization.findUniqueOrThrow({ where: { id: actor.orgId } });
      const updated = await tx.clinicalSession.update({
        where: { id },
        data: {
          status: org.requireApproval ? 'Submitted' : 'Finalized',
          actualEnd: new Date(),
          signedAt: new Date(),
          version: org.requireApproval ? 0 : 1,
        },
      });
      await tx.appointment.update({
        where: { id: s.appointmentId },
        data: { status: 'Completed' },
      });
      if (!org.requireApproval) await enqueueReport(tx, id, 1);
      return updated;
    });
    await audit(actor, 'session.complete', id);
    return Response.json(result);
  }
  if (action === 'approve' && method === 'POST') {
    roles(actor, 'ADMIN', 'BCBA');
    const result = await db.$transaction(async (tx) => {
      await lockSession(tx, id);
      const s = await tx.clinicalSession.findUniqueOrThrow({ where: { id } });
      if (s.status === 'Finalized') return s;
      if (s.status !== 'Submitted')
        throw new HttpError(409, 'This session is not awaiting review.');
      if (s.therapistId === actor.id)
        throw new HttpError(403, 'A separate clinician must approve this session.');
      const updated = await tx.clinicalSession.update({
        where: { id },
        data: { status: 'Finalized', version: 1, approvedAt: new Date(), approvedBy: actor.id },
      });
      await enqueueReport(tx, id, 1);
      return updated;
    });
    await audit(actor, 'session.approve', id);
    return Response.json(result);
  }
  if (action === 'amendments' && method === 'POST') {
    roles(actor, 'ADMIN', 'BCBA');
    const input = z
      .object({ reason: text.min(10), note: text.min(10), version: z.number().int().min(1) })
      .parse(await json(req));
    const result = await db.$transaction(async (tx) => {
      await lockSession(tx, id);
      const s = await tx.clinicalSession.findUniqueOrThrow({ where: { id } });
      if (s.status !== 'Finalized' || s.version !== input.version)
        throw new HttpError(409, 'Refresh the finalized session before amending.');
      const version = s.version + 1;
      const amendment = await tx.amendment.create({
        data: { sessionId: id, version, reason: input.reason, note: input.note, actorId: actor.id },
      });
      await tx.clinicalSession.update({ where: { id }, data: { version } });
      const prior = await tx.pdfReport.findUniqueOrThrow({
        where: { sessionId_version: { sessionId: id, version: s.version } },
      });
      await tx.pdfReport.create({
        data: {
          orgId: actor.orgId,
          sessionId: id,
          version,
          snapshot: snapshot({
            ...(prior.snapshot as object),
            version,
            note: input.note,
            amendment: { reason: input.reason, author: actor.name, createdAt: amendment.createdAt },
            originalNote: s.note,
          }),
        },
      });
      return amendment;
    });
    await audit(actor, 'session.amend', id);
    return Response.json(result, { status: 201 });
  }
  throw new HttpError(405, 'Method not allowed.');
}
async function enqueueReport(tx: Prisma.TransactionClient, id: string, version: number) {
  const session = await tx.clinicalSession.findUniqueOrThrow({
    where: { id },
    include: {
      client: true,
      therapist: { select: { name: true, title: true, certification: true, npi: true } },
      appointment: true,
      entries: { where: { voidedAt: null }, orderBy: { recordedAt: 'asc' } },
    },
  });
  const organization = await tx.organization.findUniqueOrThrow({ where: { id: session.orgId } });
  const approval = session.approvedBy
    ? await tx.user.findUnique({
        where: { id: session.approvedBy },
        select: { name: true, role: true },
      })
    : null;
  await tx.pdfReport.upsert({
    where: { sessionId_version: { sessionId: id, version } },
    update: {},
    create: {
      orgId: session.orgId,
      sessionId: id,
      version,
      snapshot: snapshot({
        ...session,
        approval,
        organization: {
          name: organization.name,
          timezone: organization.timezone,
          logoKey: organization.logoKey,
          logoMimeType: organization.logoMimeType,
        },
        summary: summarize(session.entries),
        version,
      }),
    },
  });
}
