/** Explicit hosted acceptance check with no clinical-record creation. */
import { store, retrieve, removeStored } from '../src/lib/storage';
import { renderReport } from '../src/lib/reports';
const origin = process.env.APP_ORIGIN!;
const page = await fetch(origin + '/login');
if (page.status !== 200 || !(await page.text()).includes('Welcome back'))
  throw Error('Hosted login page check failed');
const login = await fetch(origin + '/api/auth/login', {
  method: 'POST',
  headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
});
if (!login.ok) throw Error('Hosted authentication HTTP ' + login.status);
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
const dashboard = await fetch(origin + '/api/dashboard', { headers: { cookie } });
if (!dashboard.ok) throw Error('Hosted dashboard HTTP ' + dashboard.status);
const data = await dashboard.json();
if (!data.organization?.name) throw Error('Hosted persisted organization missing');
if ((await fetch(origin + '/api/clients')).status !== 401)
  throw Error('Anonymous API access was not denied');
const now = new Date().toISOString();
const pdf = await renderReport({
  id: 'synthetic-deployment-check',
  version: 1,
  organization: { name: 'Synthetic Deployment Test', timezone: 'America/New_York' },
  client: { name: 'Synthetic Test', clientCode: 'SYNTHETIC' },
  therapist: { name: 'Synthetic Test', title: 'Technical validation' },
  appointment: { location: 'Technical test', start: now, end: now },
  actualStart: now,
  actualEnd: now,
  signedAt: now,
  status: 'Finalized',
  note: 'Synthetic technical verification only. No patient observations.',
  observations: '',
  entries: [],
  summary: {
    entries: 0,
    trials: 0,
    correct: 0,
    prompted: 0,
    trialPercent: null,
    frequency: 0,
    durationMs: 0,
    numerator: 0,
    denominator: 0,
    percent: null,
  },
});
const id = await store(pdf);
try {
  if (!(await retrieve(id)).equals(pdf)) throw Error('Hosted PDF storage round trip failed');
} finally {
  await removeStored(id);
}
await fetch(origin + '/api/auth/logout', { method: 'POST', headers: { cookie, origin } });
console.log(
  'PASS: hosted login, authentication, database-backed dashboard, anonymous denial, PDF rendering and private encrypted storage round-trip. Synthetic object removed.',
);

const anon = process.env.SUPABASE_ANON_KEY;
if (anon && process.env.SUPABASE_URL) {
  const response = await fetch(process.env.SUPABASE_URL + '/rest/v1/User?select=id&limit=1', {
    headers: { apikey: anon, authorization: 'Bearer ' + anon },
  });
  if (response.ok) {
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length)
      throw Error('Anonymous database REST access is not isolated');
  } else if (![401, 403, 404].includes(response.status))
    throw Error('Anonymous database check HTTP ' + response.status);
  console.log('PASS: anonymous Supabase REST access cannot read application accounts.');
}
