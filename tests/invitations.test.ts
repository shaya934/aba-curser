import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { db } from '../src/lib/db';
import { createInvitation, acceptInvitation } from '../src/lib/invitations';
import { profiles } from '../src/lib/profiles';
import { login } from '../src/lib/auth';
const request = (data: unknown) =>
  new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(data) });
after(() => db.$disconnect());
test('secure invitations: delivery state, access control, expiry, single use and account changes', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });
  const rbt = await db.user.findUniqueOrThrow({ where: { email: 'rbt@example.test' } });
  const previous = { user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD };
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  const user = await db.user.create({
    data: {
      orgId: admin.orgId,
      name: 'Synthetic Invitation',
      email: `invite-${randomBytes(8).toString('hex')}@example.test`,
      role: 'RBT',
      passwordHash: 'unusable',
    },
  });
  const tokenOf = (url: string) => new URL(url).hash.slice(1);
  try {
    await assert.rejects(createInvitation(rbt, user.id), /permission/);
    const first = await createInvitation(admin, user.id);
    assert.equal(first.delivery, 'not_configured');
    const stored = await db.staffInvitation.findUniqueOrThrow({ where: { userId: user.id } });
    assert.notEqual(stored.tokenHash, tokenOf(first.invitationUrl));
    await db.staffInvitation.update({
      where: { userId: user.id },
      data: { expiresAt: new Date(0) },
    });
    await assert.rejects(
      acceptInvitation(
        request({ token: tokenOf(first.invitationUrl), password: 'strong synthetic password' }),
      ),
      /invalid or expired/,
    );
    const second = await createInvitation(admin, user.id);
    await assert.rejects(
      acceptInvitation(
        request({ token: tokenOf(first.invitationUrl), password: 'strong synthetic password' }),
      ),
      /invalid or expired/,
    );
    await db.authSession.create({
      data: {
        id: randomBytes(32).toString('hex'),
        userId: user.id,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        acceptInvitation(
          request({ token: tokenOf(second.invitationUrl), password: 'strong synthetic password' }),
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await db.authSession.count({ where: { userId: user.id } }), 0);
    assert.equal((await login(user.email, 'strong synthetic password')).user.id, user.id);
    const third = await createInvitation(admin, user.id);
    await db.user.update({ where: { id: user.id }, data: { email: 'changed-' + user.email } });
    await assert.rejects(
      acceptInvitation(
        request({ token: tokenOf(third.invitationUrl), password: 'strong synthetic password' }),
      ),
      /invalid or expired/,
    );
    await assert.rejects(createInvitation(admin, user.id), /Too many/);
  } finally {
    await db.auditLog.deleteMany({ where: { entityId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    if (previous.user === undefined) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = previous.user;
    if (previous.password === undefined) delete process.env.SMTP_PASSWORD;
    else process.env.SMTP_PASSWORD = previous.password;
  }
});
test('staff creation prepares an invitation and accurately reports SMTP acceptance/failure without mailing passwords', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });
  const original = nodemailer.createTransport;
  const previous = { user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD };
  process.env.SMTP_USER = 'sender@example.test';
  process.env.SMTP_PASSWORD = 'synthetic-app-password';
  let message: any;
  let fail = false;
  nodemailer.createTransport = (() => ({
    sendMail: async (mail: unknown) => {
      message = mail;
      if (fail) throw Error('synthetic failure');
      return { accepted: ['synthetic@example.test'] };
    },
    close() {},
  })) as typeof nodemailer.createTransport;
  let userId: string | undefined;
  try {
    const response = await profiles(
      admin,
      ['staff'],
      request({
        name: 'Synthetic mail therapist',
        email: `mail-${randomBytes(8).toString('hex')}@example.test`,
        role: 'RBT',
      }),
    );
    assert.equal(response?.status, 201);
    const body = await response!.json();
    userId = body.id;
    assert.equal(body.invitation.delivery, 'sent');
    assert.equal(body.passwordHash, undefined);
    assert.equal(message.to, body.email);
    assert(message.text.includes('/accept-invitation#'));
    assert(!message.text.includes('synthetic-app-password'));
    fail = true;
    assert.equal((await createInvitation(admin, userId!)).delivery, 'failed');
    await profiles(
      admin,
      ['staff', userId!],
      new Request('http://localhost/api', {
        method: 'PATCH',
        body: JSON.stringify({
          name: body.name,
          email: body.email,
          role: body.role,
          status: 'Inactive',
        }),
      }),
    );
    assert.equal(await db.staffInvitation.count({ where: { userId } }), 0);
    await assert.rejects(createInvitation(admin, userId!), /not found/);
  } finally {
    nodemailer.createTransport = original;
    if (previous.user === undefined) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = previous.user;
    if (previous.password === undefined) delete process.env.SMTP_PASSWORD;
    else process.env.SMTP_PASSWORD = previous.password;
    if (userId) {
      await db.auditLog.deleteMany({ where: { entityId: userId } });
      await db.user.delete({ where: { id: userId } });
    }
  }
});
