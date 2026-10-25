import { createHash, timingSafeEqual } from 'node:crypto';
import { recoverReport } from '@/lib/report-recovery';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32)
    return Response.json({ error: 'Report recovery is not configured.' }, { status: 503, headers });
  const digest = (s: string) => createHash('sha256').update(s).digest();
  if (
    !timingSafeEqual(digest(request.headers.get('authorization') || ''), digest(`Bearer ${secret}`))
  )
    return Response.json({ error: 'Unauthorized.' }, { status: 401, headers });
  if (process.env.VERCEL_ENV === 'preview')
    return Response.json(
      { error: 'Scheduled recovery is disabled for previews.' },
      { status: 403, headers },
    );
  try {
    const result = await recoverReport();
    return Response.json(result, { status: result.failed ? 503 : 200, headers });
  } catch {
    return Response.json(
      { error: 'Report recovery is temporarily unavailable.' },
      { status: 503, headers },
    );
  }
}
