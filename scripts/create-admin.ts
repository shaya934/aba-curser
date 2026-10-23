/** One-time operator command; never called during builds, previews, or requests. */
import { z } from 'zod';
import { db } from '../src/lib/db';
import { passwordHash } from '../src/lib/auth';
async function main() {
  const input = z
    .object({
      AGENCY_NAME: z.string().trim().min(1).max(200),
      ADMIN_NAME: z.string().trim().min(1).max(200),
      ADMIN_EMAIL: z.email().transform((v) => v.toLowerCase()),
      ADMIN_PASSWORD: z.string().min(16).max(256),
    })
    .parse(process.env);
  await db.$transaction(async (tx) => {
    // Lock the single first-administrator bootstrap across operator invocations.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8675310)`;
    if (await tx.user.count())
      throw Error(
        'Database already has accounts. Bootstrap refuses to overwrite or add administrators; use the existing agency administrator.',
      );
    const org = await tx.organization.create({ data: { name: input.AGENCY_NAME } });
    const user = await tx.user.create({
      data: {
        orgId: org.id,
        name: input.ADMIN_NAME,
        email: input.ADMIN_EMAIL,
        passwordHash: passwordHash(input.ADMIN_PASSWORD),
        role: 'ADMIN',
        title: 'Administrator',
      },
    });
    await tx.auditLog.create({
      data: { orgId: org.id, actorId: user.id, action: 'organization.bootstrap', entityId: org.id },
    });
  });
  console.log('First organization and administrator created. No credentials printed.');
}
try {
  await main();
} catch (e) {
  console.error(
    e instanceof z.ZodError
      ? 'Set AGENCY_NAME, ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD (16+ characters).'
      : e instanceof Error
        ? e.message
        : 'Administrator bootstrap failed.',
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
