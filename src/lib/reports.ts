import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import { DateTime } from 'luxon';
import { db } from './db';
import { type Actor, requireClient, clientScope, HttpError, audit } from './auth';
import { store, retrieve, removeStored } from './storage';
import { summarize } from './clinical';
let fontBytes: Promise<Buffer> | undefined;
export async function renderReport(s: any): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font: PDFFont = await pdf.embedFont(
    await (fontBytes ??= readFile('assets/fonts/DejaVuSans.ttf')),
    { subset: true },
  );
  pdf.setTitle(`Session ${s.id} · version ${s.version}`);
  pdf.setAuthor(s.organization.name);
  pdf.setSubject('ABA session documentation');
  pdf.setCreationDate(new Date(s.signedAt));
  let page: PDFPage;
  let y = 0;
  const ink = rgb(0.12, 0.24, 0.28),
    teal = rgb(0.03, 0.47, 0.48),
    muted = rgb(0.32, 0.42, 0.46);
  const newPage = () => {
    page = pdf.addPage([595.28, 841.89]);
    y = 790;
    page.drawRectangle({ x: 42, y: 800, width: 511, height: 4, color: teal });
  };
  newPage();
  if (s.organization.logoKey) {
    const bytes = await retrieve(s.organization.logoKey);
    const image =
      s.organization.logoMimeType === 'image/png'
        ? await pdf.embedPng(bytes)
        : await pdf.embedJpg(bytes);
    const dim = image.scaleToFit(55, 55);
    page!.drawImage(image, { x: 498, y: 742, width: dim.width, height: dim.height });
  }

  const line = (value: string, size = 10, color = ink) => {
    const normalized = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    for (const paragraph of normalized.split('\n')) {
      let current = '';
      const words = paragraph.split(/\s+/);
      const lines: string[] = [];
      for (const word of words) {
        const next = current ? current + ' ' + word : word;
        if (font.widthOfTextAtSize(next, size) > (y > 735 ? 440 : 505) && current) {
          lines.push(current);
          current = word;
        } else current = next;
        while (font.widthOfTextAtSize(current, size) > (y > 735 ? 440 : 505)) {
          let cut = current.length - 1;
          while (
            cut > 1 &&
            font.widthOfTextAtSize(current.slice(0, cut), size) > (y > 735 ? 440 : 505)
          )
            cut--;
          lines.push(current.slice(0, cut));
          current = current.slice(cut);
        }
      }
      lines.push(current);
      for (const text of lines) {
        if (y < 65) newPage();
        page.drawText(text, { x: 45, y, size, font, color });
        y -= size * 1.55;
      }
    }
  };
  const section = (title: string) => {
    y -= 15;
    line(title, 13, teal);
    y -= 4;
  };
  const time = (v: string) =>
    v
      ? DateTime.fromISO(v, { zone: s.organization.timezone }).toFormat(
          'MMM d, yyyy h:mm:ss a ZZZZ',
        )
      : 'Not entered';
  line(s.organization.name, 19, teal);
  line('ABA THERAPY · SESSION REPORT', 10, muted);
  line(`Session ${s.id} | Version ${s.version}`, 9, muted);
  y -= 15;
  line(`Client: ${s.client.name} | Client ID: ${s.client.clientCode}`, 12);
  line(`Therapist: ${s.therapist.name} | ${s.therapist.title || 'Clinical staff'}`);
  line(
    `Credentials: ${s.therapist.certification || 'Not entered'} | NPI: ${s.therapist.npi || 'Not entered'}`,
  );
  line(`Location: ${s.appointment.location}`);
  line(`Actual start: ${time(s.actualStart)}`);
  line(`Actual end: ${time(s.actualEnd)}`);
  line(
    `Duration: ${((new Date(s.actualEnd).getTime() - new Date(s.actualStart).getTime()) / 60000).toFixed(2)} minutes`,
  );
  line(`Scheduled: ${time(s.appointment.start)} – ${time(s.appointment.end)}`, 9, muted);
  section('Factual measurement summary');
  const a = s.summary;
  line(
    `${a.entries} measurements | ${a.trials} trials | ${a.correct} successful | ${a.prompted} prompted`,
  );
  line(
    `Trial success: ${a.trialPercent === null ? 'Not measured' : a.trialPercent.toFixed(2) + '%'} | Frequency: ${a.frequency} events | Duration: ${(a.durationMs / 1000).toFixed(2)} seconds`,
  );
  line(
    `Percentage measures: ${a.numerator}/${a.denominator}${a.percent === null ? ' (not measured)' : ` = ${a.percent.toFixed(2)}%`}`,
  );
  const targets = new Map<string, any[]>();
  for (const e of s.entries) {
    const key = `${e.targetId}:${e.targetSnapshot.version}:${e.targetSnapshot.goal.version}`;
    if (!targets.has(key)) targets.set(key, []);
    targets.get(key)!.push(e);
  }
  for (const entries of targets.values()) {
    const t = entries[0].targetSnapshot;
    section(`${t.goal.name} → ${t.name}`);
    line(`Measurement: ${t.measurement} | Definition version: ${t.version}`, 9, muted);
    line(`Mastery criteria: ${t.masteryCriteria}`, 9, muted);
    const stats = summarize(entries);
    line(
      `Recorded: ${stats.entries} entries; ${stats.correct}/${stats.trials} successful trials; ${stats.prompted} prompted; ${stats.frequency} events; ${(stats.durationMs / 1000).toFixed(2)} seconds`,
      9,
    );
    for (const e of entries) {
      const value =
        e.kind === 'Percentage'
          ? `${e.numerator}/${e.denominator} = ${((100 * e.numerator) / e.denominator).toFixed(2)}%`
          : e.kind === 'Duration'
            ? `${(e.durationMs / 1000).toFixed(2)} seconds`
            : e.kind === 'Frequency'
              ? `${e.value} events`
              : e.kind;
      line(`${time(e.recordedAt)} | ${e.kind} | ${value}`, 9, muted);
    }
  }
  section('Therapist documentation');
  line(s.note || 'No note entered.');
  section('Observed behaviors and events');
  line(s.observations || 'No additional observations entered.');
  if (s.amendment) {
    section(`Amendment · version ${s.version}`);
    line(`Reason: ${s.amendment.reason}`);
    line(`Entered by ${s.amendment.author} at ${time(s.amendment.createdAt)}`);
    line('Original signed note: ' + s.originalNote);
  }
  section('Completion and attestation');
  line(`Status: ${s.status}`);
  line(`Therapist attestation: ${s.therapist.name} at ${time(s.signedAt)}`);
  line(
    s.approvedAt
      ? `Supervisor approval: ${s.approval?.name || s.approvedBy} at ${time(s.approvedAt)}`
      : 'Supervisor approval: not required.',
  );
  line('This report summarizes recorded data and entered observations only.', 9, muted);
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(
      `PRIVATE CLINICAL DOCUMENT | Session ${s.id} | v${s.version} | ${i + 1}/${pages.length}`,
      { x: 45, y: 30, size: 7, font, color: muted },
    );
  });
  return Buffer.from(await pdf.save());
}
export async function processReport(id: string) {
  let stored: string | undefined;
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pdf:${id}`}))`;
        const report = await tx.pdfReport.findUniqueOrThrow({ where: { id } });
        if (report.status === 'Ready') return;
        const pdf = await renderReport(report.snapshot);
        stored = await store(pdf);
        await tx.pdfReport.update({
          where: { id },
          data: { storageKey: stored, status: 'Ready', error: null, attempts: { increment: 1 } },
        });
      },
      { timeout: 30000, maxWait: 30000 },
    );
    return true;
  } catch {
    if (stored) await removeStored(stored);
    await db.pdfReport.updateMany({
      where: { id, status: { not: 'Ready' } },
      data: {
        status: 'Failed',
        attempts: { increment: 1 },
        error:
          'PDF generation failed. Check storage availability and encryption-key configuration, then retry.',
      },
    });
    return false;
  }
}
export async function generateSessionReports(sessionId: string) {
  for (const report of await db.pdfReport.findMany({
    where: { sessionId, status: { not: 'Ready' } },
  }))
    await processReport(report.id);
}
export async function reports(
  actor: Actor,
  path: string[],
  req: Request,
): Promise<Response | null> {
  const [resource, id, action] = path;
  if (resource !== 'reports') return null;
  if (!id && req.method === 'GET')
    return Response.json(
      await db.pdfReport.findMany({
        where: { orgId: actor.orgId, session: { client: clientScope(actor) } },
        select: {
          id: true,
          version: true,
          status: true,
          createdAt: true,
          session: { select: { id: true, clientId: true, client: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  const report = await db.pdfReport.findFirst({
    where: { id, orgId: actor.orgId },
    include: { session: { select: { clientId: true } } },
  });
  if (!report) throw new HttpError(404, 'Report not found.');
  await requireClient(actor, report.session.clientId);
  if (req.method === 'POST' && action === 'retry') {
    const ok = await processReport(report.id);
    await audit(actor, 'report.retry', report.id);
    return Response.json({ ok }, { status: ok ? 200 : 503 });
  }
  if (req.method === 'GET' && !action) {
    if (report.status !== 'Ready' || !report.storageKey)
      throw new HttpError(409, 'This report is not ready. Retry generation.');
    await audit(actor, 'report.download', report.id);
    return new Response(new Uint8Array(await retrieve(report.storageKey)), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="session-${report.sessionId}-v${report.version}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }
  throw new HttpError(405, 'Method not allowed.');
}
