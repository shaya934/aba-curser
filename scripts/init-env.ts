import { writeFile, access, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
try {
  await access('.env');
  console.log('.env already exists; preserved.');
} catch {
  await writeFile(
    '.env',
    `DATABASE_URL=postgresql://aba:aba_local_only@localhost:5432/aba?schema=public\nAPP_ORIGIN=http://localhost:3000\nSTORAGE_DIR=./var/private\nSTORAGE_KEY=${randomBytes(32).toString('hex')}\nSEED_PASSWORD=${randomBytes(24).toString('base64url')}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'Created local .env with random development encryption key and seed password. Values are not printed.',
  );
}
await chmod('.env', 0o600);
