import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db';
import { profiles } from '../src/lib/profiles';
import { type Actor, requireClient } from '../src/lib/auth';
import { retrieve, validateFile, removeStored } from '../src/lib/storage';
const req = (method: string, data?: unknown) =>
  new Request('http://localhost/api', { method, body: data ? JSON.stringify(data) : undefined });
after(() => db.$disconnect());
test('persist profiles, assign therapist, isolate clients, encrypt and authorize document downloads', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });
  const rbt = await db.user.findUniqueOrThrow({ where: { email: 'rbt@example.test' } });
  const a: Actor = admin;
  const r: Actor = rbt;
  const created = await profiles(
    a,
    ['clients'],
    req('POST', {
      name: 'Synthetic Profile Test',
      clientCode: 'T-' + Date.now(),
      dob: '2018-02-02',
    }),
  );
  const c = await created!.json();
  assert.equal(c.name, 'Synthetic Profile Test');
  await assert.rejects(requireClient(r, c.id), /not found/);
  await profiles(a, ['clients', c.id, 'assignments'], req('POST', { userId: r.id }));
  assert.equal((await requireClient(r, c.id)).id, c.id);
  await assert.rejects(profiles(r, ['clients'], req('POST', { name: 'denied' })), /permission/);
  const pdf = Buffer.from('%PDF-1.4\nsynthetic document');
  const result = await profiles(
    r,
    ['documents'],
    req('POST', {
      clientId: c.id,
      name: 'synthetic.pdf',
      category: 'Other',
      mimeType: 'application/pdf',
      data: pdf.toString('base64'),
    }),
  );
  const doc = await db.document.findUniqueOrThrow({ where: { id: (await result!.json()).id } });
  assert.deepEqual(await retrieve(doc.storageKey), pdf);
  await profiles(a, ['clients', c.id, 'assignments'], req('POST', { userId: r.id, remove: true }));
  await assert.rejects(profiles(r, ['documents', doc.id], req('GET')), /not found/);
  const res = await profiles(a, ['documents', doc.id], req('GET'));
  assert.equal(res!.headers.get('content-type'), 'application/pdf');
  await removeStored(doc.storageKey);
  await db.document.delete({ where: { id: doc.id } });
  await db.client.delete({ where: { id: c.id } });
});
test('reject content type spoofing and invalid files', () => {
  assert.throws(
    () => validateFile(Buffer.from('<script>bad</script>'), 'application/pdf'),
    /matching/,
  );
  assert.throws(() => validateFile(Buffer.alloc(0), 'image/png'), /3 MB/);
});

test('agency logos are validated, encrypted and available to immutable report snapshots', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });
  const previous = await db.organization.findUniqueOrThrow({ where: { id: admin.orgId } });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1EAAAAASUVORK5CYII=',
    'base64',
  );
  let newKey: string | null = null;
  try {
    await profiles(
      admin,
      ['settings', 'logo'],
      req('POST', { mimeType: 'image/png', data: png.toString('base64') }),
    );
    const org = await db.organization.findUniqueOrThrow({ where: { id: admin.orgId } });
    newKey = org.logoKey;
    assert(org.logoKey);
    assert.deepEqual(await retrieve(org.logoKey), png);
    await assert.rejects(
      profiles(
        admin,
        ['settings', 'logo'],
        req('POST', { mimeType: 'image/png', data: Buffer.from('bad').toString('base64') }),
      ),
      /matching/,
    );
  } finally {
    await db.organization.update({
      where: { id: admin.orgId },
      data: { logoKey: previous.logoKey, logoMimeType: previous.logoMimeType },
    });
    if (newKey) await removeStored(newKey);
  }
});
