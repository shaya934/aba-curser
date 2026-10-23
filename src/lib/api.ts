import { validateVercelConfiguration } from './deployment';
import { rateLimit } from './limits';
import { DateTime } from 'luxon';
import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { reports, generateSessionReports } from './reports';
import { clinical } from './clinical';
import { goals } from './goals';
import { schedule } from './scheduling';
import { profiles } from './profiles';
import { json } from './validation';
import { currentActor, login, logout, HttpError, clientScope } from './auth';
export async function handle(request: NextRequest, path: string[]) {
  try {
    if (process.env.VERCEL) validateVercelConfiguration();
    if (!['GET', 'HEAD'].includes(request.method)) {
      const origin = request.headers.get('origin');
      if (!origin || origin !== new URL(process.env.APP_ORIGIN || request.url).origin)
        throw new HttpError(403, 'Invalid request origin.');
    }
    const route = path.join('/');
    if (route === 'auth/login' && request.method === 'POST') {
      const body = z
        .object({ email: z.email().max(254), password: z.string().min(1).max(256) })
        .parse(await json(request));
      const result = await login(body.email, body.password);
      const response = NextResponse.json(result.user);
      response.cookies.set('aba_session', result.token, {
        httpOnly: true,
        sameSite: 'strict',
        secure:
          process.env.NODE_ENV === 'production' && process.env.APP_ORIGIN?.startsWith('https://'),
        path: '/',
        maxAge: 8 * 3600,
      });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    const actor = await currentActor();
    await rateLimit(`user:${actor.id}`);
    if (route === 'auth/logout' && request.method === 'POST') {
      await logout(request.cookies.get('aba_session')?.value);
      const response = NextResponse.json({ ok: true });
      response.cookies.delete('aba_session');
      return response;
    }
    if (route === 'me') return NextResponse.json(actor);
    if (route === 'dashboard') {
      const scope = clientScope(actor);
      const organization = await db.organization.findUniqueOrThrow({ where: { id: actor.orgId } });
      const todayStart = DateTime.now().setZone(organization.timezone).startOf('day').toJSDate();
      const tomorrow = DateTime.now()
        .setZone(organization.timezone)
        .startOf('day')
        .plus({ days: 1 })
        .toJSDate();
      const clients = await db.client.count({ where: { ...scope, status: 'Active' } });
      const appointments = await db.appointment.findMany({
        where: {
          orgId: actor.orgId,
          client: scope,
          ...(actor.role === 'ADMIN' ? {} : { therapistId: actor.id }),
        },
        include: {
          client: true,
          therapist: { select: { name: true } },
          session: { select: { id: true } },
        },
        orderBy: { start: 'asc' },
      });
      const sessions = await db.clinicalSession.findMany({
        where: {
          orgId: actor.orgId,
          client: scope,
          ...(actor.role === 'RBT' || actor.role === 'BT' ? { therapistId: actor.id } : {}),
        },
        select: { id: true, status: true, note: true },
      });
      const today = appointments.filter((a) => a.start >= todayStart && a.start < tomorrow);
      const metrics = {
        scheduled: today.filter((a) => a.status === 'Scheduled').length,
        completed: today.filter((a) => a.status === 'Completed').length,
        cancelled: today.filter((a) => ['Cancelled', 'No Show'].includes(a.status)).length,
        missingNotes: sessions.filter((s) => s.status !== 'Finalized').length,
      };
      return NextResponse.json({
        clients,
        staff:
          actor.role === 'ADMIN'
            ? await db.user.count({ where: { orgId: actor.orgId, status: 'Active' } })
            : undefined,
        appointments,
        sessions,
        organization,
        metrics,
      });
    }
    const reportResponse = await reports(actor, path, request);
    if (reportResponse) return reportResponse as NextResponse;
    const clinicalResponse = await clinical(actor, path, request);
    if (clinicalResponse) {
      if (
        request.method === 'POST' &&
        path[0] === 'sessions' &&
        ['finalize', 'approve', 'amendments'].includes(path[2])
      )
        await generateSessionReports(path[1]);
      return clinicalResponse as NextResponse;
    }
    const goalResponse = await goals(actor, path, request);
    if (goalResponse) return goalResponse as NextResponse;
    const scheduleResponse = await schedule(actor, path, request);
    if (scheduleResponse) return scheduleResponse as NextResponse;
    const profileResponse = await profiles(actor, path, request);
    if (profileResponse) return profileResponse as NextResponse;
    throw new HttpError(404, 'Not found.');
  } catch (error) {
    return apiError(error);
  }
}
export function apiError(error: unknown) {
  if (error instanceof HttpError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  if (error instanceof SyntaxError)
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2002', 'P2034', 'P2003'].includes(error.code)
  )
    return NextResponse.json(
      { error: 'This change conflicts with an existing record. Refresh and try again.' },
      { status: 409 },
    );
  // Never log request bodies or clinical records.
  console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
  return NextResponse.json(
    { error: 'The operation could not be completed. Please try again.' },
    { status: 500 },
  );
}
