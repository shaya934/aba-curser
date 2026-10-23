import { db } from './db';
import { processReport } from './reports';
/** One job per invocation keeps retries within serverless duration limits.
 * Finalization still generates its own report immediately. */
export async function recoverReport() {
  const job = await db.pdfReport.findFirst({
    where: { status: { not: 'Ready' }, attempts: { lt: 5 } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!job) return { processed: 0, failed: 0 };
  const ok = await processReport(job.id);
  return { processed: 1, failed: ok ? 0 : 1 };
}
