import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { type Actor, roles, requireClient, clientScope, HttpError, audit } from './auth';
import { json, short, text, day } from './validation';
export const measurements = [
  'Correct/Incorrect',
  'Independent/Prompted',
  'Frequency',
  'Duration',
  'Percentage',
  'Yes/No',
] as const;
export const statuses = ['Not Started', 'Active', 'Mastered', 'On Hold', 'Discontinued'] as const;
const goalInput = z.object({
  clientId: z.string().min(1),
  name: short.min(1),
  description: text.default(''),
  domain: short.min(1),
  startDate: day,
  status: z.enum(statuses).default('Active'),
  masteryCriteria: text.min(1),
  version: z.coerce.number().int().optional(),
});
const targetInput = z.object({
  name: short.min(1),
  description: text.default(''),
  measurement: z.enum(measurements),
  baseline: short.default(''),
  masteryCriteria: text.min(1),
  status: z.enum(statuses).default('Active'),
  version: z.coerce.number().int().optional(),
});
export const snapshot = (data: unknown) =>
  JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
export async function goals(actor: Actor, path: string[], req: Request): Promise<Response | null> {
  const [resource, id, action] = path;
  if (!['goals', 'targets'].includes(resource)) return null;
  const method = req.method;
  if (resource === 'goals' && !id && method === 'GET')
    return Response.json(
      await db.goal.findMany({
        where: { orgId: actor.orgId, client: clientScope(actor) },
        include: { targets: { orderBy: { createdAt: 'asc' } }, client: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  if (resource === 'goals' && !id && method === 'POST') {
    roles(actor, 'ADMIN', 'BCBA');
    const { version: _v, ...data } = goalInput.parse(await json(req));
    await requireClient(actor, data.clientId);
    const result = await db.$transaction(async (tx) => {
      const goal = await tx.goal.create({ data: { ...data, orgId: actor.orgId } });
      await tx.clinicalHistory.create({
        data: {
          orgId: actor.orgId,
          entityId: goal.id,
          entityType: 'Goal',
          version: 1,
          snapshot: snapshot(goal),
          actorId: actor.id,
        },
      });
      return goal;
    });
    await audit(actor, 'goal.create', result.id);
    return Response.json(result, { status: 201 });
  }
  if (!id) throw new HttpError(404, 'Definition not found.');
  const entity =
    resource === 'goals'
      ? await db.goal.findFirst({ where: { id, orgId: actor.orgId } })
      : await db.target.findFirst({
          where: { id, goal: { orgId: actor.orgId } },
          include: { goal: true },
        });
  if (!entity) throw new HttpError(404, 'Definition not found.');
  const clientId = 'clientId' in entity ? entity.clientId : entity.goal.clientId;
  await requireClient(actor, clientId);
  if (method === 'GET' && action === 'history')
    return Response.json(
      await db.clinicalHistory.findMany({
        where: { entityId: id, orgId: actor.orgId },
        orderBy: { version: 'desc' },
      }),
    );
  if (method === 'GET') return Response.json(entity);
  roles(actor, 'ADMIN', 'BCBA');
  if (resource === 'goals' && action === 'targets' && method === 'POST') {
    const { version: _v, ...data } = targetInput.parse(await json(req));
    const result = await db.$transaction(async (tx) => {
      const target = await tx.target.create({
        data: { ...data, goalId: id, masteredAt: data.status === 'Mastered' ? new Date() : null },
      });
      await tx.clinicalHistory.create({
        data: {
          orgId: actor.orgId,
          entityId: target.id,
          entityType: 'Target',
          version: 1,
          snapshot: snapshot(target),
          actorId: actor.id,
        },
      });
      return target;
    });
    await audit(actor, 'target.create', result.id);
    return Response.json(result, { status: 201 });
  }
  if (method === 'PATCH') {
    const raw = await json(req);
    const parsed = resource === 'goals' ? goalInput.parse(raw) : targetInput.parse(raw);
    const { version, ...data } = parsed;
    if (version !== entity.version)
      throw new HttpError(409, 'This definition changed. Refresh before editing.');
    if ('clientId' in data && data.clientId !== clientId)
      throw new HttpError(400, 'A goal cannot move between clients.');
    const result = await db.$transaction(async (tx) => {
      if (resource === 'goals') {
        const goalData = goalInput.omit({ version: true }).parse(data);
        const changed = await tx.goal.updateMany({
          where: { id, version },
          data: { ...goalData, version: { increment: 1 } },
        });
        if (!changed.count)
          throw new HttpError(409, 'This definition changed. Refresh before editing.');
        const goal = await tx.goal.findUniqueOrThrow({ where: { id } });
        await tx.clinicalHistory.create({
          data: {
            orgId: actor.orgId,
            entityId: id,
            entityType: 'Goal',
            version: goal.version,
            snapshot: snapshot(goal),
            actorId: actor.id,
          },
        });
        return goal;
      }
      const targetData = targetInput.omit({ version: true }).parse(data);
      const changed = await tx.target.updateMany({
        where: { id, version },
        data: {
          ...targetData,
          masteredAt:
            targetData.status === 'Mastered'
              ? ('masteredAt' in entity ? entity.masteredAt : null) || new Date()
              : null,
          version: { increment: 1 },
        },
      });
      if (!changed.count)
        throw new HttpError(409, 'This definition changed. Refresh before editing.');
      const target = await tx.target.findUniqueOrThrow({ where: { id } });
      await tx.clinicalHistory.create({
        data: {
          orgId: actor.orgId,
          entityId: id,
          entityType: 'Target',
          version: target.version,
          snapshot: snapshot(target),
          actorId: actor.id,
        },
      });
      return target;
    });
    await audit(actor, resource === 'goals' ? 'goal.update' : 'target.update', id);
    return Response.json(result);
  }
  throw new HttpError(405, 'Method not allowed.');
}
