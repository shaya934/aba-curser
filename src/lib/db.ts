import { runtimeDatabaseUrl, postgresConnectionOptions } from './deployment';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const connection = runtimeDatabaseUrl();
if (process.env.VERCEL && !connection) throw Error('Hosted PostgreSQL URL is missing.');
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db =
  globalDb.prisma ??
  new PrismaClient({
    adapter: new PrismaPg(
      new Pool({
        ...postgresConnectionOptions(connection),
        max: 3,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 10000,
        allowExitOnIdle: true,
      }),
    ),
  });
globalDb.prisma = db;
