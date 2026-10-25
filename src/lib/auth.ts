import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { cookies } from 'next/headers.js';
import { db } from './db';
import type { User } from '@prisma/client';
export type Actor = Pick<User, 'id' | 'orgId' | 'role' | 'name' | 'email'>;
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, hash: string) {
  const [salt, digest] = hash.split(':');
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function login(email: string, password: string) {
  const key = `login:${createHash('sha256').update(email.toLowerCase()).digest('hex')}`;
  const now = new Date();
  const limit = await db.rateLimit.upsert({
    where: { key },
    create: { key, resetAt: new Date(+now + 900000) },
    update: { attempts: { increment: 1 } },
  });
  if (limit.resetAt < now)
    await db.rateLimit.update({
      where: { key },
      data: { attempts: 1, resetAt: new Date(+now + 900000) },
    });
  else if (limit.attempts > 10)
    throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  // Perform the same password derivation even for unknown accounts.
  const valid = verifyPassword(
    password,
    user?.passwordHash ?? '00000000000000000000000000000000:' + '00'.repeat(64),
  );
  if (!user || !valid || user.status !== 'Active')
    throw new HttpError(401, 'Email or password is incorrect.');
  const token = randomBytes(32).toString('hex');
  await db.authSession.create({
    data: { id: tokenHash(token), userId: user.id, expiresAt: new Date(Date.now() + 8 * 3600000) },
  });
  await db.rateLimit.deleteMany({ where: { key } });
  await audit(user, 'auth.login', user.id);
  return { token, user: publicUser(user) };
}
export function publicUser(user: User) {
  const { passwordHash: _hash, ...safe } = user;
  return safe;
}
export async function actorFromToken(token?: string): Promise<Actor> {
  if (!token) throw new HttpError(401, 'Please sign in.');
  const session = await db.authSession.findUnique({
    where: { id: tokenHash(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date() || session.user.status !== 'Active')
    throw new HttpError(401, 'Your session expired. Please sign in again.');
  return {
    id: session.user.id,
    orgId: session.user.orgId,
    role: session.user.role,
    name: session.user.name,
    email: session.user.email,
  };
}
export async function currentActor() {
  return actorFromToken((await cookies()).get('aba_session')?.value);
}
export async function logout(token?: string) {
  if (token) await db.authSession.deleteMany({ where: { id: tokenHash(token) } });
}
export function roles(actor: Actor, ...allowed: Actor['role'][]) {
  if (!allowed.includes(actor.role))
    throw new HttpError(403, 'You do not have permission for this action.');
}
export const clientScope = (actor: Actor) => ({
  orgId: actor.orgId,
  ...(actor.role === 'ADMIN' ? {} : { assignments: { some: { userId: actor.id } } }),
});
export async function requireClient(actor: Actor, id: string) {
  const client = await db.client.findFirst({ where: { id, ...clientScope(actor) } });
  if (!client) throw new HttpError(404, 'Client not found.');
  return client;
}
export async function audit(actor: Actor, action: string, entityId: string) {
  await db.auditLog.create({ data: { orgId: actor.orgId, actorId: actor.id, action, entityId } });
}
