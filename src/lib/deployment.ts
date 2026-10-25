import { supabaseStorageConfiguration } from './supabase-storage';
/** Configuration checks report variable names only, never credential values. */
type Env = Record<string, string | undefined>;
export function storageDriver(env: Env = process.env): 'local' | 's3' | 'supabase' {
  const driver = env.STORAGE_DRIVER || (env.VERCEL ? '' : 'local');
  if (driver !== 'local' && driver !== 's3' && driver !== 'supabase')
    throw Error('Set STORAGE_DRIVER to s3 for Vercel, or local for development.');
  if (env.VERCEL && driver === 'local')
    throw Error('Vercel requires persistent S3 storage; its filesystem is ephemeral.');
  return driver;
}
export function s3Configuration(env: Env = process.env) {
  for (const name of ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
    if (!env[name]?.trim()) throw Error(`Missing ${name}.`);
  }
  if (env.S3_ENDPOINT) {
    const url = new URL(env.S3_ENDPOINT);
    const local = !env.VERCEL && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['', '/'].includes(url.pathname) ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    )
      throw Error('S3_ENDPOINT must be an HTTPS origin (HTTP loopback allowed for local tests).');
  }
  return {
    bucket: env.S3_BUCKET!,
    options: {
      region: env.S3_REGION!,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      },
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 },
    },
  };
}
export function validateVercelConfiguration(env: Env = process.env) {
  if (!['s3', 'supabase'].includes(env.STORAGE_DRIVER || ''))
    throw Error('Vercel requires STORAGE_DRIVER=s3 or supabase.');
  storageDriver({ ...env, VERCEL: '1' });
  if (env.STORAGE_DRIVER === 'supabase') supabaseStorageConfiguration({ ...env, VERCEL: '1' });
  else s3Configuration({ ...env, VERCEL: '1' });
  if (!env.STORAGE_KEY || !/^[a-f0-9]{64}$/i.test(env.STORAGE_KEY))
    throw Error('STORAGE_KEY must be 32 random bytes encoded as 64 hex characters.');
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32 || /\s/.test(env.CRON_SECRET))
    throw Error('CRON_SECRET must contain at least 32 non-whitespace characters.');
  const origin = new URL(env.APP_ORIGIN || '');
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== env.APP_ORIGIN ||
    origin.username ||
    origin.password
  )
    throw Error('APP_ORIGIN must be the exact HTTPS application origin without a trailing slash.');
  env = { ...env, DATABASE_URL: runtimeDatabaseUrl(env) };
  for (const name of ['DATABASE_URL', 'DATABASE_DIRECT_URL'] as const) {
    if (name === 'DATABASE_DIRECT_URL' && !env[name]) continue;
    if (!env[name])
      throw Error(`Missing ${name}. Use a pooled runtime URL and a direct migration URL.`);
    const url = new URL(env[name]!);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !['require', 'verify-full', 'verify-ca'].includes(url.searchParams.get('sslmode') || '')
    )
      throw Error(`${name} must be a PostgreSQL URL with TLS (sslmode=require or verify-full).`);
  }
}

export function migrationDatabaseUrl(env: Env = process.env) {
  let value = env.DATABASE_DIRECT_URL || env.DATABASE_URL;
  if (!value && env.POSTGRES_URL) {
    const u = new URL(runtimeDatabaseUrl(env)!);
    if (u.hostname.endsWith('.pooler.supabase.com')) {
      u.port = '5432';
      u.searchParams.delete('pgbouncer');
      return u.toString();
    }
  }
  value = value || runtimeDatabaseUrl(env);
  if (!value) throw Error('Set DATABASE_DIRECT_URL for migrations.');
  const url = new URL(value);
  if (!env.DATABASE_DIRECT_URL && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw Error(
      'Set DATABASE_DIRECT_URL to a direct PostgreSQL connection for migration session locks.',
    );
  return value;
}

export function runtimeDatabaseUrl(env: Env = process.env) {
  const value = env.DATABASE_URL || env.POSTGRES_URL;
  if (!value) return undefined;
  if (!env.DATABASE_URL && env.POSTGRES_PASSWORD) {
    const u = new URL(value);
    u.password = encodeURIComponent(env.POSTGRES_PASSWORD);
    return u.toString();
  }
  return value;
}

/** An explicit provider CA supplements trust without weakening TLS verification.
 * pg's URL sslmode parameter overrides its ssl object, so remove only that
 * parameter when an operator-supplied CA is configured. Hostname checks remain on.
 */
export function postgresConnectionOptions(
  connectionString: string | undefined,
  env: Env = process.env,
) {
  if (!connectionString || !env.DATABASE_SSL_CA) return { connectionString };
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('sslrootcert');
  return {
    connectionString: url.toString(),
    ssl: { ca: env.DATABASE_SSL_CA, rejectUnauthorized: true },
  };
}
