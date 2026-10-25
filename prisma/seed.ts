import { db } from '../src/lib/db';
import { passwordHash } from '../src/lib/auth';
async function main() {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12)
    throw new Error('Set SEED_PASSWORD to a development password of at least 12 characters.');
  const org = await db.organization.upsert({
    where: { id: 'synthetic-agency' },
    update: {},
    create: { id: 'synthetic-agency', name: 'BrightPath Demo • Synthetic Data' },
  });
  for (const [role, name] of [
    ['ADMIN', 'Alex Morgan'],
    ['BCBA', 'Jordan Lee'],
    ['RBT', 'Taylor Reed'],
  ] as const) {
    await db.user.upsert({
      where: { email: `${role.toLowerCase()}@example.test` },
      update: {},
      create: {
        orgId: org.id,
        email: `${role.toLowerCase()}@example.test`,
        name,
        role,
        passwordHash: passwordHash(password),
        title: role,
      },
    });
  }
  console.log(
    'Synthetic agency and admin/bcba/rbt@example.test accounts created. Existing passwords preserved.',
  );
}
main().finally(() => db.$disconnect());
