/** Server-only adapter for the user's existing Supabase private storage. */
export function supabaseStorageConfiguration(
  env: Record<string, string | undefined> = process.env,
) {
  const value = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value || !key)
    throw Error('Supabase storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const url = new URL(value);
  const local = !env.VERCEL && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname) ||
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
  )
    throw Error('Supabase storage requires an HTTPS origin.');
  const bucket = env.SUPABASE_STORAGE_BUCKET || 'brightpath-private';
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket)) throw Error('Invalid private bucket name.');
  return { url: url.origin, key, bucket };
}
async function request(path: string, method = 'GET', body?: BodyInit, contentType?: string) {
  const config = supabaseStorageConfiguration();
  const r = await fetch(`${config.url}/storage/v1/${path}`, {
    method,
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
      ...(contentType ? { 'content-type': contentType } : {}),
      'x-upsert': 'false',
    },
    body,
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  });
  if (!r.ok) throw Error(`Private storage operation failed (HTTP ${r.status}).`);
  return r;
}
export async function putSupabaseObject(id: string, data: Buffer) {
  const { bucket } = supabaseStorageConfiguration();
  await request(
    `object/${bucket}/brightpath/${id}`,
    'POST',
    new Uint8Array(data),
    'application/octet-stream',
  );
}
export async function getSupabaseObject(id: string) {
  const { bucket } = supabaseStorageConfiguration();
  return Buffer.from(
    await (await request(`object/authenticated/${bucket}/brightpath/${id}`)).arrayBuffer(),
  );
}
export async function removeSupabaseObject(id: string) {
  const { bucket } = supabaseStorageConfiguration();
  await request(
    `object/${bucket}`,
    'DELETE',
    JSON.stringify({ prefixes: [`brightpath/${id}`] }),
    'application/json',
  );
}
export async function ensurePrivateBucket() {
  const config = supabaseStorageConfiguration();
  const headers = {
    apikey: config.key,
    authorization: `Bearer ${config.key}`,
    'content-type': 'application/json',
  };
  let r = await fetch(`${config.url}/storage/v1/bucket/${config.bucket}`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 404) {
    await request(
      'bucket',
      'POST',
      JSON.stringify({
        id: config.bucket,
        name: config.bucket,
        public: false,
        allowed_mime_types: ['application/octet-stream'],
      }),
      'application/json',
    );
    r = await request(`bucket/${config.bucket}`);
  }
  if (!r.ok) throw Error(`Private bucket check failed (HTTP ${r.status}).`);
  const bucket = await r.json();
  if (bucket.public !== false)
    throw Error('The application bucket must be private. Refusing public storage.');
}
