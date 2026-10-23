import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordHash, verifyPassword, roles, HttpError, actorFromToken } from '../src/lib/auth';
test('salted passwords verify without accepting a different password', () => {
  const a = passwordHash('synthetic-password');
  assert(verifyPassword('synthetic-password', a));
  assert(!verifyPassword('wrong', a));
  assert.notEqual(a, passwordHash('synthetic-password'));
});
test('server roles deny an RBT administrator capabilities', () => {
  assert.throws(
    () => roles({ id: 'x', orgId: 'o', role: 'RBT', name: 'X', email: 'x@example.test' }, 'ADMIN'),
    HttpError,
  );
});
test('missing session cannot authenticate', async () => {
  await assert.rejects(actorFromToken(), /sign in/);
});
test('database connection, real login, token expiration and tenant-scoped lookup', async () => {
  const { db } = await import('../src/lib/db');
  const { login, logout, requireClient } = await import('../src/lib/auth');
  const account = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });
  const result = await login(account.email, process.env.SEED_PASSWORD!);
  assert.equal((await actorFromToken(result.token)).orgId, account.orgId);
  await assert.rejects(
    requireClient(await actorFromToken(result.token), 'missing-client'),
    /not found/,
  );
  await logout(result.token);
  await assert.rejects(actorFromToken(result.token), /expired/);
  await assert.rejects(login(account.email, 'wrong-password'), /incorrect/);
  await db.$disconnect();
});
