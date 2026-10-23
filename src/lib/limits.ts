import { createHash } from 'node:crypto';
import { db } from './db';
import { HttpError } from './auth';
export async function rateLimit(identity: string, max = 600, windowMs = 60000) {
  const key = createHash('sha256').update(identity).digest('hex');
  const now = new Date();
  const rows = await db.$queryRaw<
    { attempts: number }[]
  >`INSERT INTO "RateLimit" ("key","attempts","resetAt") VALUES (${key},1,${new Date(+now + windowMs)}) ON CONFLICT ("key") DO UPDATE SET "attempts"=CASE WHEN "RateLimit"."resetAt" < ${now} THEN 1 ELSE "RateLimit"."attempts"+1 END,"resetAt"=CASE WHEN "RateLimit"."resetAt" < ${now} THEN ${new Date(+now + windowMs)} ELSE "RateLimit"."resetAt" END RETURNING "attempts"`;
  if (rows[0].attempts > max)
    throw new HttpError(429, 'Too many requests. Please wait a moment and try again.');
}
