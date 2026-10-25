import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { verifyPassword } from '../src/lib/auth';
const run = promisify(execFile);
test('first-admin operator bootstrap initializes a fresh database and refuses a second run', async () => {
  const name = 'aba_bootstrap_' + randomBytes(8).toString('hex');
  const url = new URL(process.env.DATABASE_URL!);
  const owner = new Client({ connectionString: url.toString() });
  await owner.connect();
  await owner.query(`CREATE DATABASE "${name}"`);
  url.pathname = '/' + name;
  const password = randomBytes(24).toString('base64url');
  const env = {
    ...process.env,
    DATABASE_URL: url.toString(),
    DATABASE_DIRECT_URL: url.toString(),
    AGENCY_NAME: 'Synthetic Hosted Agency',
    ADMIN_NAME: 'Synthetic Initial Admin',
    ADMIN_EMAIL: 'bootstrap@example.test',
    ADMIN_PASSWORD: password,
  };
  const inspect = new Client({ connectionString: url.toString() });
  try {
    await run(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], { env });
    await run(process.execPath, ['--import', 'tsx', 'scripts/create-admin.ts'], { env });
    await inspect.connect();
    let result = await inspect.query('SELECT role,"passwordHash" FROM "User"');
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].role, 'ADMIN');
    assert(verifyPassword(password, result.rows[0].passwordHash));
    await assert.rejects(
      run(process.execPath, ['--import', 'tsx', 'scripts/create-admin.ts'], { env }),
      /already has accounts/,
    );
    result = await inspect.query('SELECT id FROM "User"');
    assert.equal(result.rows.length, 1);
    assert.equal((await inspect.query('SELECT id FROM "Organization"')).rows.length, 1);
  } finally {
    await inspect.end();
    await owner.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await owner.end();
  }
});
