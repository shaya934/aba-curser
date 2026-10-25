import { DateTime, IANAZone } from 'luxon';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { type Actor, roles, requireClient, clientScope, HttpError, audit } from './auth';
import { json } from './validation';
export const locations = ['Home', 'Clinic', 'School', 'Community', 'Telehealth', 'Other'] as const;
const input = z.object({
  clientId: z.string().min(1),
  therapistId: z.string().min(1),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  timezone: z.string().refine((v) => IANAZone.isValidZone(v), 'Invalid IANA timezone'),
  location: z.enum(locations),
  frequency: z.enum(['Once', 'Daily', 'Weekly']).default('Once'),
  count: z.coerce.number().int().min(1).max(52).default(1),
});
export type ScheduleInput = z.infer<typeof input>;
export function expandAppointments(data: ScheduleInput) {
  const parse = (s: string) => {
    const d = DateTime.fromISO(s, { zone: data.timezone });
    if (!d.isValid || d.toFormat("yyyy-MM-dd'T'HH:mm") !== s)
      throw new HttpError(
        400,
        'This local time does not exist because of daylight saving. Choose another time.',
      );
    if (d.getPossibleOffsets().length > 1)
      throw new HttpError(
        400,
        'This local time is ambiguous because of daylight saving. Choose a time outside the repeated hour.',
      );
    return d;
  };
  const start = parse(data.start),
    end = parse(data.end);
  if (end <= start || end.diff(start, 'hours').hours > 24)
    throw new HttpError(400, 'End time must follow start time, within 24 hours.');
  return Array.from({ length: data.frequency === 'Once' ? 1 : data.count }, (_, i) => {
    const offset = data.frequency === 'Weekly' ? { weeks: i } : { days: i };
    const s = start.plus(offset),
      e = end.plus(offset);
    parse(s.toFormat("yyyy-MM-dd'T'HH:mm"));
    parse(e.toFormat("yyyy-MM-dd'T'HH:mm"));
    if (s.hour !== start.hour || e.hour !== end.hour || e <= s)
      throw new HttpError(
        400,
        'A recurring time falls in a daylight-saving gap. Choose another time.',
      );
    return { start: s.toJSDate(), end: e.toJSDate() };
  });
}
export async function schedule(
  actor: Actor,
  path: string[],
  req: Request,
): Promise<Response | null> {
  if (path[0] !== 'appointments') return null;
  const [, id] = path;
  const method = req.method;
  if (method === 'GET')
    return Response.json(
      await db.appointment.findMany({
        where: {
          orgId: actor.orgId,
          client: clientScope(actor),
          ...(actor.role === 'RBT' || actor.role === 'BT' ? { therapistId: actor.id } : {}),
          ...(id ? { id } : {}),
        },
        include: {
          client: { select: { name: true, id: true } },
          therapist: { select: { name: true, id: true } },
          session: { select: { id: true } },
        },
        orderBy: { start: 'asc' },
      }),
    );
  roles(actor, 'ADMIN');
  if ((method === 'POST' && !id) || (method === 'PATCH' && id)) {
    const body = await json(req);
    if (method === 'PATCH' && body.status) {
      const status = z.enum(['Cancelled', 'No Show', 'Scheduled']).parse(body.status);
      const result = await db.$transaction(async (tx) => {
        await lockSchedule(tx, actor.orgId);
        const prior = await tx.appointment.findFirst({ where: { id, orgId: actor.orgId } });
        if (!prior) throw new HttpError(404, 'Appointment not found.');
        if (['Completed', 'In Progress'].includes(prior.status))
          throw new HttpError(
            409,
            'An active or completed session cannot be cancelled or rescheduled.',
          );
        if (status === 'Scheduled') await checkOverlap(tx, prior, prior.id);
        return tx.appointment.update({ where: { id }, data: { status } });
      });
      await audit(actor, 'appointment.status', id!);
      return Response.json(result);
    }
    const data = input.parse(body);
    const client = await requireClient(actor, data.clientId);
    if (client.status !== 'Active')
      throw new HttpError(400, 'Schedule appointments only for active clients.');
    if (
      !(await db.user.findFirst({
        where: {
          id: data.therapistId,
          orgId: actor.orgId,
          status: 'Active',
          assignments: { some: { clientId: data.clientId } },
        },
      }))
    )
      throw new HttpError(400, 'Choose an active therapist assigned to this client.');
    const occurrences = expandAppointments(data);
    const result = await db.$transaction(async (tx) => {
      await lockSchedule(tx, actor.orgId);
      if (id) {
        const prior = await tx.appointment.findFirst({ where: { id, orgId: actor.orgId } });
        if (!prior) throw new HttpError(404, 'Appointment not found.');
        if (prior.status !== 'Scheduled' || occurrences.length !== 1)
          throw new HttpError(409, 'Only a scheduled single occurrence can be rescheduled.');
      }
      const rule =
        !id && data.frequency !== 'Once'
          ? await tx.recurringRule.create({
              data: {
                orgId: actor.orgId,
                timezone: data.timezone,
                frequency: data.frequency,
                count: occurrences.length,
                localStart: data.start,
                localEnd: data.end,
              },
            })
          : null;
      const appointments = [];
      for (const time of occurrences) {
        const record = {
          orgId: actor.orgId,
          clientId: data.clientId,
          therapistId: data.therapistId,
          location: data.location,
          timezone: data.timezone,
          ...time,
        };
        await checkOverlap(tx, record, id);
        appointments.push(
          id
            ? await tx.appointment.update({ where: { id }, data: record })
            : await tx.appointment.create({ data: { ...record, recurrenceId: rule?.id } }),
        );
      }
      return appointments;
    });
    await audit(actor, id ? 'appointment.reschedule' : 'appointment.create', result[0].id);
    return Response.json(result, { status: id ? 200 : 201 });
  }
  throw new HttpError(405, 'Method not allowed.');
}
export async function lockSchedule(tx: Prisma.TransactionClient, orgId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}))`;
}
async function checkOverlap(
  tx: Prisma.TransactionClient,
  record: { orgId: string; clientId: string; therapistId: string; start: Date; end: Date },
  exclude?: string,
) {
  const conflict = await tx.appointment.findFirst({
    where: {
      orgId: record.orgId,
      ...(exclude ? { id: { not: exclude } } : {}),
      status: { notIn: ['Cancelled', 'No Show'] },
      start: { lt: record.end },
      end: { gt: record.start },
      OR: [{ clientId: record.clientId }, { therapistId: record.therapistId }],
    },
  });
  if (conflict)
    throw new HttpError(409, 'This client or therapist already has an overlapping appointment.');
}
