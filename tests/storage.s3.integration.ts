/** Contract checks against a real local HTTP S3 emulator, not a mocked SDK.
 * Start moto_server on loopback port 5000 (see docs/VERCEL_DEPLOYMENT.md).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { store, retrieve, removeStored } from '../src/lib/storage';
import { db } from '../src/lib/db';
import { fixture, cleanup, req } from './helpers';
import { clinical } from '../src/lib/clinical';
import { recoverReport } from '../src/lib/report-recovery';
import { GET as cron } from '../src/app/api/cron/reports/route';
const endpoint = process.env.S3_TEST_ENDPOINT || 'http://127.0.0.1:5000';
const options = {
  endpoint,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: 'synthetic-test', secretAccessKey: 'synthetic-test' },
};
const client = new S3Client(options);
after(async () => {
  client.destroy();
  await db.$disconnect();
});
async function cloudTest(run: (bucket: string) => Promise<void>) {
  const previous = { ...process.env };
  const bucket = 'aba-test-' + randomBytes(8).toString('hex');
  Object.assign(process.env, {
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: endpoint,
    S3_BUCKET: bucket,
    S3_REGION: 'us-east-1',
    S3_FORCE_PATH_STYLE: 'true',
    S3_ACCESS_KEY_ID: 'synthetic-test',
    S3_SECRET_ACCESS_KEY: 'synthetic-test',
    STORAGE_KEY: randomBytes(32).toString('hex'),
  });
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  try {
    await run(bucket);
  } finally {
    for (const item of (await client.send(new ListObjectsV2Command({ Bucket: bucket }))).Contents ||
      []) {
      if (item.Key) await removeStored(item.Key.replace('brightpath/', ''));
    }
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}
test('S3 stores ciphertext privately, authenticates decryption, supports deletion and rejects invalid keys', async () =>
  cloudTest(async (bucket) => {
    const plain = Buffer.from('%PDF-1.4\nSynthetic private clinical document');
    const id = await store(plain);
    const raw = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: 'brightpath/' + id }),
    );
    const encrypted = Buffer.from(await raw.Body!.transformToByteArray());
    assert(!encrypted.includes(plain));
    assert.equal(raw.ContentType, 'application/octet-stream');
    assert.deepEqual(await retrieve(id), plain);
    assert.equal((await fetch(`${endpoint}/${bucket}/brightpath/${id}`)).status, 403);
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 1;
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: 'brightpath/' + id, Body: tampered }),
    );
    await assert.rejects(retrieve(id));
    await assert.rejects(retrieve('../../private-key'), /not found/);
    await removeStored(id);
    await assert.rejects(retrieve(id));
    await removeStored(id);
  }));
test('durable report retry generates and decrypts a PDF through S3; authenticated cron invokes the queue', async () =>
  cloudTest(async () => {
    const f = await fixture();
    try {
      const s = await (await clinical(
        f.rbt,
        ['sessions', 'start'],
        req('POST', { appointmentId: f.appointment.id }),
      ))!.json();
      await clinical(
        f.rbt,
        ['sessions', s.id, 'entries'],
        req('POST', {
          targetId: f.targets.Frequency.id,
          kind: 'Frequency',
          value: 2,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      await clinical(
        f.rbt,
        ['sessions', s.id, 'notes'],
        req('PATCH', {
          note: 'Synthetic cloud recovery session note.',
          observations: '',
          noteRevision: 0,
        }),
      );
      await clinical(
        f.rbt,
        ['sessions', s.id, 'finalize'],
        req('POST', { attest: true, noteRevision: 1 }),
      );
      const key = process.env.STORAGE_KEY;
      process.env.STORAGE_KEY = 'invalid';
      assert.deepEqual(await recoverReport(), { processed: 1, failed: 1 });
      process.env.STORAGE_KEY = key;
      process.env.CRON_SECRET = randomBytes(32).toString('hex');
      delete process.env.VERCEL_ENV;
      const result = await cron(
        new Request('http://localhost/api/cron/reports', {
          headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        }),
      );
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), { processed: 1, failed: 0 });
      const report = await db.pdfReport.findFirstOrThrow({ where: { sessionId: s.id } });
      assert.equal(report.status, 'Ready');
      assert.equal(report.attempts, 2);
      assert.equal((await retrieve(report.storageKey!)).subarray(0, 5).toString(), '%PDF-');
      assert.deepEqual(await recoverReport(), { processed: 0, failed: 0 });
    } finally {
      await cleanup(f);
    }
  }));
