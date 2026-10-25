import { createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { db } from './db';
import { audit, HttpError, passwordHash, roles, type Actor } from './auth';
import { rateLimit } from './limits';
import { json } from './validation';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const emailConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);

export async function createInvitation(actor: Actor, userId: string) {
  roles(actor, 'ADMIN');
  const user = await db.user.findFirst({
    where: { id: userId, orgId: actor.orgId, status: 'Active' },
  });
  if (!user) throw new HttpError(404, 'Active staff member not found.');
  await rateLimit(`invite:${userId}`, 3, 15 * 60000);
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 48 * 3600000);
  await db.staffInvitation.upsert({
    where: { userId },
    create: { userId, email: user.email, tokenHash: hash(token), expiresAt },
    update: { email: user.email, tokenHash: hash(token), expiresAt, createdAt: new Date() },
  });
  // The fragment keeps the secret out of HTTP access logs and Referer headers.
  const url = new URL('/accept-invitation', process.env.APP_ORIGIN || 'http://localhost:3000');
  url.hash = token;
  let delivery: 'sent' | 'not_configured' | 'failed' = 'not_configured';
  if (emailConfigured()) {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 465),
      secure: (process.env.SMTP_PORT || '465') === '465',
      requireTLS: true,
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    try {
      const result = await transport.sendMail({
        from: process.env.SMTP_USER!,
        to: user.email,
        subject: 'Your Brightpath account invitation',
        text: `Your agency has invited you to Brightpath. Set your password using this one-time link:\n\n${url}\n\nThe link expires in 48 hours. If you were not expecting this invitation, ignore this email.`,
      });
      delivery = result.accepted.length > 0 ? 'sent' : 'failed';
    } catch {
      // Never log SMTP credentials or token-bearing message contents.
      delivery = 'failed';
    } finally {
      transport.close();
    }
  }
  await audit(actor, `staff.invitation.${delivery}`, userId);
  return { delivery, invitationUrl: url.toString(), expiresAt };
}

export async function acceptInvitation(req: Request) {
  const { token, password } = z
    .object({
      token: z.string().regex(/^[a-f0-9]{64}$/),
      password: z.string().min(12).max(256),
    })
    .parse(await json(req));
  await rateLimit(`accept-invite:${hash(token)}`, 10, 15 * 60000);
  const invitation = await db.staffInvitation.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: true },
  });
  if (
    !invitation ||
    invitation.expiresAt <= new Date() ||
    invitation.user.status !== 'Active' ||
    invitation.email !== invitation.user.email
  )
    throw new HttpError(
      400,
      'This invitation is invalid or expired. Ask your administrator for a new invitation.',
    );
  const newHash = passwordHash(password);
  await db.$transaction(async (tx) => {
    const consumed = await tx.staffInvitation.deleteMany({
      where: {
        userId: invitation.userId,
        tokenHash: hash(token),
        expiresAt: { gt: new Date() },
        user: { status: 'Active', email: invitation.email },
      },
    });
    if (consumed.count !== 1)
      throw new HttpError(400, 'This invitation has already been used or replaced.');
    await tx.user.update({ where: { id: invitation.userId }, data: { passwordHash: newHash } });
    await tx.authSession.deleteMany({ where: { userId: invitation.userId } });
    await tx.auditLog.create({
      data: {
        orgId: invitation.user.orgId,
        actorId: invitation.userId,
        action: 'staff.invitation.accept',
        entityId: invitation.userId,
      },
    });
  });
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
