// Read-only hosted connectivity check. Logs status codes only, never credentials.
import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
let ca = process.env.DATABASE_SSL_CA;
if (!ca) {
  const certResponse = await fetch(
    'https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt',
  );
  if (!certResponse.ok) throw Error('Official CA download HTTP ' + certResponse.status);
  ca = await certResponse.text();
}
let failed = false;
for (const name of ['POSTGRES_URL', 'POSTGRES_URL_NON_POOLING']) {
  const value = process.env[name];
  if (!value) {
    console.log(name + ': missing');
    failed = true;
    continue;
  }
  const uri = new URL(value);
  if (process.env.POSTGRES_PASSWORD)
    uri.password = encodeURIComponent(process.env.POSTGRES_PASSWORD);
  uri.searchParams.delete('sslmode');
  const client = new pg.Client({
    connectionString: uri.toString(),
    ssl: { ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 8000,
    query_timeout: 8000,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    console.log(name + ': connected');
  } catch (e) {
    console.log(name + ': failed (' + (e.code || e.name) + ')');
    if (name === 'POSTGRES_URL') failed = true;
  } finally {
    await client.end().catch(() => {});
  }
}
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url && key) {
  try {
    const r = await fetch(url + '/storage/v1/bucket', {
      headers: { apikey: key, authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(10000),
    });
    console.log('Private storage API: HTTP ' + r.status);
    if (!r.ok) failed = true;
  } catch {
    console.log('Private storage API: unreachable');
    failed = true;
  }
} else {
  console.log('Private storage API: missing integration credential');
  failed = true;
}
if (failed) process.exitCode = 1;
else {
  await mkdir('.deployment-preflight', { recursive: true });
  await writeFile(
    '.deployment-preflight/index.html',
    '<!doctype html><title>Deployment connectivity verified</title><p>Hosted connectivity verified. Application deployment follows.</p>',
  );
}
