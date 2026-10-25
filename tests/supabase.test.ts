import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { store, retrieve, removeStored } from '../src/lib/storage';
import { ensurePrivateBucket } from '../src/lib/supabase-storage';
import {
  runtimeDatabaseUrl,
  migrationDatabaseUrl,
  postgresConnectionOptions,
} from '../src/lib/deployment';
test('Supabase private REST adapter stores encrypted objects, verifies bucket privacy and rejects tampering', async () => {
  const previous = { ...process.env };
  const objects = new Map<string, Buffer>();
  let bucket: any = null;
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer synthetic') {
      res.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = Buffer.concat(chunks);
    const path = req.url!;
    if (path === '/storage/v1/bucket/brightpath-private') {
      res
        .writeHead(bucket ? 200 : 400, { 'content-type': 'application/json' })
        .end(JSON.stringify(bucket || {statusCode:'404',error:'Bucket not found'}));
      return;
    }
    if (path === '/storage/v1/bucket' && req.method === 'POST') {
      bucket = JSON.parse(body.toString());
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(bucket));
      return;
    }
    if (path === '/storage/v1/object/brightpath-private' && req.method === 'DELETE') {
      for (const id of JSON.parse(body.toString()).prefixes) objects.delete(id);
      res.writeHead(200).end('[]');
      return;
    }
    const id = path.split('/brightpath-private/')[1];
    if (req.method === 'POST') {
      objects.set(id, body);
      res.writeHead(200).end('{}');
      return;
    }
    if (!objects.has(id)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end(objects.get(id));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  try {
    delete process.env.VERCEL;
    Object.assign(process.env, {
      STORAGE_DRIVER: 'supabase',
      SUPABASE_URL: `http://127.0.0.1:${port}`,
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
      STORAGE_KEY: randomBytes(32).toString('hex'),
    });
    await ensurePrivateBucket();
    assert.equal(bucket.public, false);
    const plain = Buffer.from('synthetic private document');
    const id = await store(plain);
    const encrypted = objects.get('brightpath/' + id)!;
    assert(!encrypted.includes(plain));
    assert.deepEqual(await retrieve(id), plain);
    encrypted[encrypted.length - 1] ^= 1;
    await assert.rejects(retrieve(id));
    await removeStored(id);
    await assert.rejects(retrieve(id));
    bucket.public = true;
    await assert.rejects(ensurePrivateBucket(), /private/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in previous)) delete process.env[k];
    Object.assign(process.env, previous);
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test('Supabase integration URL mappings use current password and a session pool for migrations', () => {
  const env = {
    POSTGRES_URL:
      'postgres://postgres.synthetic:old@aws-0.pooler.supabase.com:6543/postgres?sslmode=verify-full&pgbouncer=true',
    POSTGRES_PASSWORD: 'new@p%/ss:word',
  };
  const url = new URL(runtimeDatabaseUrl(env)!);
  assert.equal(decodeURIComponent(url.password), env.POSTGRES_PASSWORD);
  const direct = new URL(migrationDatabaseUrl(env));
  assert.equal(direct.port, '5432');
  assert(!direct.searchParams.has('pgbouncer'));
});

test('provider CA configuration keeps certificate and hostname verification enabled', () => {
  const options = postgresConnectionOptions('postgres://u:p@db.example.test/aba?sslmode=require', {
    DATABASE_SSL_CA: 'test-ca',
  });
  assert.equal(options.ssl?.rejectUnauthorized, true);
  assert.equal(options.ssl?.ca, 'test-ca');
  assert(!new URL(options.connectionString!).searchParams.has('sslmode'));
});
