import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { currentActor, login, logout, HttpError, clientScope } from './auth';
export async function handle(request: NextRequest, path: string[]) {
  try {
    if (!['GET','HEAD'].includes(request.method)) {
      const origin = request.headers.get('origin');
      if (!origin || origin !== new URL(process.env.APP_ORIGIN || request.url).origin) throw new HttpError(403, 'Invalid request origin.');
    }
    const route = path.join('/');
    if (route === 'auth/login' && request.method === 'POST') {
      const body = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) }).parse(await request.json());
      const result = await login(body.email, body.password);
      const response = NextResponse.json(result.user);
      response.cookies.set('aba_session', result.token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' && process.env.APP_ORIGIN?.startsWith('https://'), path: '/', maxAge: 8 * 3600 });
      response.headers.set('Cache-Control','no-store');
      return response;
    }
    const actor = await currentActor();
    if (route === 'auth/logout' && request.method === 'POST') {
      await logout(request.cookies.get('aba_session')?.value);
      const response = NextResponse.json({ ok: true }); response.cookies.delete('aba_session'); return response;
    }
    if (route === 'me') return NextResponse.json(actor);
    if (route === 'dashboard') {
      const scope = clientScope(actor);
      const clients = await db.client.count({ where: { ...scope, status: 'Active' } });
      const appointments = await db.appointment.findMany({ where: { orgId: actor.orgId, client: scope, ...(actor.role === 'ADMIN' ? {} : { therapistId: actor.id }) }, include: { client: true, therapist: { select: { name: true } }, session: { select: { id: true } } }, orderBy: { start: 'asc' } });
      const sessions = await db.clinicalSession.findMany({ where: { orgId: actor.orgId, client: scope }, select: { id: true, status: true, note: true } });
      const organization = await db.organization.findUniqueOrThrow({ where: { id: actor.orgId } });
      return NextResponse.json({ clients, staff: actor.role === 'ADMIN' ? await db.user.count({ where: { orgId: actor.orgId, status: 'Active' } }) : undefined, appointments, sessions, organization });
    }
    throw new HttpError(404, 'Not found.');
  } catch (error) { return apiError(error); }
}
export function apiError(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002','P2034','P2003'].includes(error.code)) return NextResponse.json({ error: 'This change conflicts with an existing record. Refresh and try again.' }, { status: 409 });
  // Never log request bodies or clinical records.
  console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
  return NextResponse.json({ error: 'The operation could not be completed. Please try again.' }, { status: 500 });
}
