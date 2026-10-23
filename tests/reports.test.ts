import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { db } from '../src/lib/db';
import { clinical } from '../src/lib/clinical';
import { processReport, reports } from '../src/lib/reports';
import { retrieve } from '../src/lib/storage';
import { profiles } from '../src/lib/profiles';
import { fixture, cleanup, req } from './helpers';
after(() => db.$disconnect());
test('PDF includes factual data, is privately encrypted, retry-safe, authorized and versioned', async () => {
  const f = await fixture();
  const previousOrg = await db.organization.findUniqueOrThrow({ where: { id: f.admin.orgId } });
  let logoKey: string | null = null;
  try {
    const logo =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1EAAAAASUVORK5CYII=';
    await profiles(
      f.admin,
      ['settings', 'logo'],
      req('POST', { mimeType: 'image/png', data: logo }),
    );
    logoKey = (await db.organization.findUniqueOrThrow({ where: { id: f.admin.orgId } })).logoKey;

    const s = await (await clinical(
      f.rbt,
      ['sessions', 'start'],
      req('POST', { appointmentId: f.appointment.id }),
    ))!.json();
    await clinical(
      f.rbt,
      ['sessions', s.id, 'entries'],
      req('POST', {
        targetId: f.targets['Percentage'].id,
        kind: 'Percentage',
        numerator: 3,
        denominator: 4,
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    await clinical(
      f.rbt,
      ['sessions', s.id, 'entries'],
      req('POST', {
        targetId: f.targets['Correct/Incorrect'].id,
        kind: 'Prompted',
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    await clinical(
      f.rbt,
      ['sessions', s.id, 'notes'],
      req('PATCH', {
        note: 'Synthetic PDF test note: factual entered observation.',
        observations: 'Synthetic activities only.',
        noteRevision: 0,
      }),
    );
    await clinical(
      f.rbt,
      ['sessions', s.id, 'finalize'],
      req('POST', { attest: true, noteRevision: 1 }),
    );
    const report = await db.pdfReport.findUniqueOrThrow({
      where: { sessionId_version: { sessionId: s.id, version: 1 } },
    });
    assert.equal((report.snapshot as any).organization.logoKey, logoKey);
    const originalKey = process.env.STORAGE_KEY;
    process.env.STORAGE_KEY = 'invalid';
    assert.equal(await processReport(report.id), false);
    process.env.STORAGE_KEY = originalKey;
    assert.equal(
      (await db.pdfReport.findUniqueOrThrow({ where: { id: report.id } })).status,
      'Failed',
    );
    assert.deepEqual(await Promise.all([processReport(report.id), processReport(report.id)]), [
      true,
      true,
    ]);
    const ready = await db.pdfReport.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(ready.attempts, 2);
    const pdf = await retrieve(ready.storageKey!);
    assert(pdf.subarray(0, 5).toString() === '%PDF-');
    assert(pdf.includes(Buffer.from('/Subtype /Image')), 'PDF embeds agency logo image');
    assert((await PDFDocument.load(pdf)).getPageCount() > 0);
    const text = execFileSync('pdftotext', ['-', '-'], { input: pdf }).toString();
    assert(text.includes('75.00%'));
    assert(text.includes('Synthetic PDF test note'));
    assert(text.includes('Prompted'));
    assert(text.includes(s.id));
    assert(text.includes(f.c.clientCode));
    const download = await reports(f.rbt, ['reports', report.id], req('GET'));
    assert.equal(download!.headers.get('content-type'), 'application/pdf');
    await db.assignment.deleteMany({ where: { clientId: f.c.id, userId: f.rbt.id } });
    await assert.rejects(reports(f.rbt, ['reports', report.id], req('GET')), /not found/);
    await clinical(
      f.bcba,
      ['sessions', s.id, 'amendments'],
      req('POST', {
        version: 1,
        reason: 'Synthetic correction for PDF',
        note: 'Synthetic version two amended documentation.',
      }),
    );
    const v2 = await db.pdfReport.findUniqueOrThrow({
      where: { sessionId_version: { sessionId: s.id, version: 2 } },
    });
    assert(await processReport(v2.id));
    assert.equal(
      (await db.pdfReport.findUniqueOrThrow({ where: { id: report.id } })).storageKey,
      ready.storageKey,
    );
    assert(
      execFileSync('pdftotext', ['-', '-'], {
        input: await retrieve(
          (await db.pdfReport.findUniqueOrThrow({ where: { id: v2.id } })).storageKey!,
        ),
      })
        .toString()
        .includes('Synthetic version two'),
    );
  } finally {
    await db.organization.update({
      where: { id: f.admin.orgId },
      data: { logoKey: previousOrg.logoKey, logoMimeType: previousOrg.logoMimeType },
    });
    if (logoKey) {
      const { removeStored } = await import('../src/lib/storage');
      await removeStored(logoKey);
    }
    await cleanup(f);
  }
});
