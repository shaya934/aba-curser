import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  validateVercelConfiguration,
  migrationDatabaseUrl,
  storageDriver,
  s3Configuration,
} from '../src/lib/deployment';
import { validateFile, MAX_UPLOAD_BYTES } from '../src/lib/storage';
import { json } from '../src/lib/validation';
import { GET } from '../src/app/api/cron/reports/route';
const valid = {
  DATABASE_URL: 'postgresql://synthetic:synthetic@db.example.test/aba?sslmode=verify-full',
  DATABASE_DIRECT_URL:
    'postgresql://synthetic:synthetic@direct.example.test/aba?sslmode=verify-full',
  APP_ORIGIN: 'https://brightpath.example.test',
  STORAGE_DRIVER: 's3',
  STORAGE_KEY: 'a'.repeat(64),
  S3_BUCKET: 'synthetic-private',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'synthetic',
  S3_SECRET_ACCESS_KEY: 'synthetic',
  CRON_SECRET: 'c'.repeat(40),
};
test('Vercel validates required durable services and HTTPS without exposing credentials', () => {
  assert.doesNotThrow(() => validateVercelConfiguration(valid));
  for (const name of [
    'DATABASE_URL',
    'APP_ORIGIN',
    'STORAGE_KEY',
    'CRON_SECRET',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ])
    assert.throws(() => validateVercelConfiguration({ ...valid, [name]: '' }), name);
  assert.throws(() => validateVercelConfiguration({ ...valid, STORAGE_DRIVER: 'local' }), /s3/);
  assert.throws(
    () => validateVercelConfiguration({ ...valid, DATABASE_URL: 'postgresql://u:p@db.test/aba' }),
    /TLS/,
  );
  assert.throws(
    () => validateVercelConfiguration({ ...valid, APP_ORIGIN: 'http://brightpath.example.test' }),
    /HTTPS/,
  );
  assert.throws(
    () => validateVercelConfiguration({ ...valid, S3_ENDPOINT: 'http://bucket.example.test' }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      validateVercelConfiguration({
        ...valid,
        S3_ENDPOINT: 'https://user:password@bucket.example.test',
      }),
    /HTTPS/,
  );
  assert.equal(storageDriver({}), 'local');
  assert.throws(() => storageDriver({ VERCEL: '1' }), /s3/);
  assert.throws(
    () => s3Configuration({ ...valid, VERCEL: '1', S3_ENDPOINT: 'http://localhost:9000' }),
    /HTTPS/,
  );
});
test('serverless upload limits reject oversized files and JSON bodies before storage', async () => {
  assert.throws(() => validateFile(Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'application/pdf'), /3 MB/);
  await assert.rejects(
    json(new Request('http://localhost', { method: 'POST', body: 'x'.repeat(4_200_001) })),
    /too large/,
  );
  const data = JSON.stringify({ data: Buffer.alloc(MAX_UPLOAD_BYTES).toString('base64') });
  assert(Buffer.byteLength(data) < 4_200_000);
});
test('cron denies absent/wrong tokens and missing configuration; previews cannot run recovery', async () => {
  const old = process.env.CRON_SECRET,
    oldPreview = process.env.VERCEL_ENV;
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await GET(new Request('http://localhost/api/cron/reports'))).status, 503);
    process.env.CRON_SECRET = randomBytes(32).toString('hex');
    for (const token of ['', 'Bearer wrong']) {
      const result = await GET(
        new Request('http://localhost/api/cron/reports', { headers: { authorization: token } }),
      );
      assert.equal(result.status, 401);
      assert.equal(result.headers.get('cache-control'), 'private, no-store');
    }
    process.env.VERCEL_ENV = 'preview';
    assert.equal(
      (
        await GET(
          new Request('http://localhost/api/cron/reports', {
            headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
          }),
        )
      ).status,
      403,
    );
  } finally {
    if (old === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = old;
    if (oldPreview === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = oldPreview;
  }
});
test('Vercel config uses bounded Node routes and a daily cron compatible with entry plans', async () => {
  const v = JSON.parse(await readFile('vercel.json', 'utf8'));
  assert.equal(v.buildCommand, 'npm run build:vercel');
  assert.deepEqual(v.crons, [{ path: '/api/cron/reports', schedule: '0 5 * * *' }]);
  const source = await readFile('next.config.ts', 'utf8');
  assert(source.includes('assets/fonts/DejaVuSans.ttf'));
});

test('remote migrations require a direct connection and local development remains simple', () => {
  assert.equal(
    migrationDatabaseUrl({ DATABASE_URL: 'postgresql://localhost/aba' }),
    'postgresql://localhost/aba',
  );
  assert.throws(
    () => migrationDatabaseUrl({ DATABASE_URL: valid.DATABASE_URL }),
    /direct PostgreSQL/,
  );
  assert.equal(migrationDatabaseUrl(valid), valid.DATABASE_DIRECT_URL);
});
