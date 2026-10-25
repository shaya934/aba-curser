/** Explicit operator job only; never part of normal builds or application requests. */
import { Client } from 'pg';
import { migrationDatabaseUrl, postgresConnectionOptions } from '../src/lib/deployment';
import { ensurePrivateBucket } from '../src/lib/supabase-storage';
const client = new Client({
  ...postgresConnectionOptions(migrationDatabaseUrl()),
  connectionTimeoutMillis: 10000,
});
try {
  await client.connect();
  const { rows } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
  if (rows.length && !rows.some((r) => r.tablename === '_prisma_migrations'))
    throw Error('Database contains existing unrelated tables; operator inspection required.');
} finally {
  await client.end();
}
await import('./migrate');
await ensurePrivateBucket();
console.log(
  'Prisma connection configuration:',
  JSON.stringify({
    pooled: !!process.env.POSTGRES_URL,
    explicit: !!process.env.DATABASE_URL,
    ca: !!process.env.DATABASE_SSL_CA,
  }),
);
const { db } = await import('../src/lib/db');
try {
  if (await db.user.count())
    console.log('Existing accounts preserved; administrator bootstrap skipped.');
  else {
    await import('./create-admin');
    if (process.exitCode) throw Error('Administrator bootstrap failed.');
  }
  console.log(
    'Hosted database migrations, private bucket and administrator initialization completed.',
  );
} finally {
  await db.$disconnect();
}
