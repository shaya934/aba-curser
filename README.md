# BrightPath — ABA therapy management

A calm, responsive care workspace built with Next.js 16, React 19, TypeScript, Tailwind, PostgreSQL 17 and Prisma 6. No paid services are needed for development. The complete seven-phase implementation and executed checks are recorded in [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md).

**Use synthetic data only until the pre-production safeguards in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) are completed. Code alone does not establish HIPAA compliance.**

## Vercel hosting

For hosted deployment, follow [the Vercel guide](docs/VERCEL_DEPLOYMENT.md). It covers private S3 or the existing Supabase storage integration, pooled PostgreSQL, operator-run migrations/first-admin creation, deployment variables, daily protected cron recovery and a hosted smoke-test checklist. No paid services or public deployment were created. Local setup below remains supported.

## Quick start

Prerequisites: Node.js 24 LTS, npm, Docker with Compose (or a PostgreSQL database), and Linux/macOS. The lockfile pins dependencies.

```sh
npm ci
# Local development database only; credentials in compose.yaml are not production secrets.
docker compose up -d --wait db
npm run setup
npm run dev
```

`setup` preserves an existing `.env`, otherwise generates random encryption and development seed-password values, generates Prisma's JavaScript driver client, applies SQL migrations transactionally, and seeds a synthetic agency and accounts. The database uses the persistent `aba-postgres-data` Docker volume. `docker compose down` preserves it; do not use `down -v` if data is needed.

The development application listens on port 3000. Sign in with `admin@example.test`, `bcba@example.test`, or `rbt@example.test` and the **local `SEED_PASSWORD` in `.env`**. Passwords are never printed by setup and `.env` is ignored by Git. Set your own strong `SEED_PASSWORD` before first seeding if preferred. Rerunning seed preserves existing account passwords. Administrators create staff accounts and can reset passwords from staff profiles; password/role/status changes revoke existing sessions.

For a remote PostgreSQL instance, create `.env` from `.env.example`, configure the pooled `DATABASE_URL` and a `DATABASE_DIRECT_URL` for migrations, generate a 32-byte hex `STORAGE_KEY` (`openssl rand -hex 32`), set `SEED_PASSWORD` to at least 12 characters and run `npm run setup` without starting Compose. Do not use the development seed in production; provision the first organization/administrator with the operator-only `npm run admin:create` command described in the Vercel guide.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection, including TLS parameters for hosted databases |
| `APP_ORIGIN` | Exact browser origin for CSRF validation; HTTPS in deployed environments |
| `STORAGE_KEY` | 64 hex characters; AES-256-GCM key; keep securely backed up |
| `STORAGE_DIR` | Private encrypted object directory; default `./var/private`; never expose as web assets |
| `SEED_PASSWORD` | Development seed only; minimum 12 characters; no production default |
| `CHROMIUM_PATH` | Optional system Chromium/Chrome executable for browser tests |

Prisma uses its supported `@prisma/adapter-pg` JavaScript engine. `scripts/generate.ts` invokes the version-pinned Prisma generator API to avoid an unused native-engine prefetch on restricted networks; it never disables artifact verification. PostgreSQL executes the checked-in Prisma SQL migrations through `scripts/migrate.ts`, which uses an advisory lock, per-migration transactions, SHA-256 checksums and the standard `_prisma_migrations` table. The CLI can also apply these migrations with `prisma migrate deploy` where its native engine is available. Do not edit an applied migration; add a new migration directory. `prisma/schema.prisma` describes the ORM models; SQL migrations also contain integrity triggers/check constraints.

```sh
npm run db:generate
npm run db:migrate
npm run db:seed             # synthetic users, idempotent
npm run reports:retry       # one recovery pass
npm run reports:worker      # recovery loop, every 30 seconds
```

## Care workflow

1. Administrator creates client/staff profiles and assigns both the BCBA and therapist to the client. Client profiles include overview, goals, schedule, sessions, recorded progress and documents; staff profiles include credentials, availability, assignments, schedules and files.
2. Assigned BCBA (or administrator) creates a goal and active targets. Choose Correct/Incorrect, Independent/Prompted, Frequency, Duration, Percentage or Yes/No. Changes retain clinical-definition versions and mastery dates.
3. Administrator schedules the assigned therapist. Day/week/month calendars support filters, rescheduling, cancellation, no-show, restoration and daily/weekly recurrence (up to 52 occurrences). Enter wall-clock times in an explicit IANA timezone. DST gaps and ambiguous repeated hours are rejected rather than guessed; weekly recurrences preserve local times.
4. Therapist opens the appointment and starts a session. Large controls save entries immediately. Counters, timers, numerator/denominator percentages and notes persist in PostgreSQL. Timers survive reloads; stop any remaining timer before completing. Undo voids a measurement without deleting its audit history. A target changed during a timer retains its starting definition.
5. Notes autosave with visible status. If another window edits the same note, copy your changes, refresh, and reconcile them; stale notes cannot overwrite newer ones. Unacknowledged measurement retries retain the same key. Navigation is blocked while browser changes remain unsaved. Do not close a tab with unsaved changes; there is no offline clinical-data cache.
6. Review the data and note, attest, and complete. If agency settings require supervisor approval, the session becomes Submitted and a separate assigned BCBA/administrator approves it. Otherwise it finalizes immediately. Signed documentation is read-only; authorized amendments create new versions and preserve the original.
7. A private PDF is generated automatically from the immutable finalized snapshot. Session and client Documents links authorize every download against tenant and current assignments. The PDF includes actual/scheduled times, individual measurements and factual summaries, notes, credentials, attestation and supervisor approval. This attestation is an application record, not a certified digital-signature service.

Administrators can upload a PNG/JPEG agency logo in Settings (up to 500 KB). New reports embed it; existing versions retain their original branding.

Administrator dashboard cards link to active clients/staff, today's appointments/completions/cancellations and pending documentation. "Today" follows the agency timezone; calendar display uses the browser's timezone, with appointment timezone labeled on details.

## Validation

Use only a disposable synthetic database with seed accounts. Tests create and remove synthetic fixtures; UI goal-form tests intentionally leave synthetic examples visible. No tests are meant to run against patient records.

Start the database and application first (`npm run dev`, or `npm run build` then `npm start`). In another terminal:

```sh
npm run typecheck
npm test                   # real PostgreSQL services + live HTTP acceptance
npm run test:e2e            # Chromium desktop/mobile forms and session lifecycle
npm run build
npm audit --omit=dev --audit-level=high
```

PDF content tests require `pdftotext` (`poppler-utils` on Debian/Ubuntu). Browser tests use `/usr/bin/chromium` when available; otherwise install Playwright's browser with `npx playwright install --with-deps chromium`, or set `CHROMIUM_PATH`. Tests read the seed password from `.env` without printing it. `npm run format` formats the source. The GitHub Actions workflow runs the same database, HTTP, build and browser checks on synthetic data.

The acceptance test verifies administrator login → client/staff creation → assignments → BCBA goal/all target types → appointment → therapist login/session → persisted measurements/notes → finalization/PDF → accurate report text/client linkage → unauthorized denial. Service tests cover tenant boundaries, RBT permissions, concurrent booking, DST, retries, corrections, version history, approval, immutable records, encryption and failed-job recovery.

## Runtime and recovery

For a deployed instance, build once and run the application plus the small retry worker under your process supervisor:

```sh
npm run build
npm start
# Separate process, same configuration and private storage:
npm run reports:worker
```

Finalization saves the session and report snapshot in one transaction before rendering. Rendering failure cannot remove the signed session. Immediate generation handles normal requests; the worker recovers interrupted/pending/failed jobs after restarts (automatic attempts capped at five, with authorized manual retry available). PostgreSQL report locks and unique session/version keys prevent duplicate report records/artifacts from concurrent retries. A process crash after a file write but before DB commit can leave an unreachable encrypted object; reconcile those against document/report metadata during maintenance, without deleting referenced objects.

Private local storage is the development alternative to the implemented S3-compatible encrypted object backend. Set `STORAGE_DRIVER=s3` with the documented credentials for hosted deployments. Keep the private directory outside public assets. Before horizontal scaling, use the private S3 backend or an appropriately encrypted shared volume. Key rotation needs a deliberate re-encryption migration; simply replacing the key makes old files unreadable.

### Backup and restore

Back up PostgreSQL, the private object directory and encryption keys together with restricted permissions and off-machine encrypted retention. Keys must be separately access-controlled; losing the key loses document access. For the local synthetic environment:

```sh
mkdir -p var/backups
chmod 700 var/backups
docker exec aba-postgres pg_dump -U aba -d aba -Fc > var/backups/aba.dump
# Copy var/private separately using encrypted, access-controlled backup storage.
# Restore into an empty disposable PostgreSQL database before trusting a backup:
# docker exec -i aba-postgres pg_restore -U aba -d <empty-database> --no-owner < var/backups/aba.dump
```

Set a legally reviewed retention/legal-hold policy; the application archives client/staff profiles by status and preserves signed sessions, history and report versions. It does not automatically purge clinical data. Database dumps, encryption keys, logs and file backups must never enter Git or public storage. See the limitations document for production controls.

## Code map

- `src/components/`: responsive feature screens and accessible form/dialog primitives.
- `src/lib/auth.ts`, `limits.ts`: passwords, expiring sessions, authorization and rate limits.
- `src/lib/profiles.ts`, `scheduling.ts`, `goals.ts`, `clinical.ts`: validated domain services.
- `src/lib/reports.ts`, `storage.ts`: factual PDF rendering, durable jobs and encrypted files.
- `src/app/api/[...path]/route.ts`, `src/lib/api.ts`: authenticated API dispatch/error boundary.
- `prisma/`: database models, checked-in migrations and synthetic seed.
- `tests/`: database/API/integration checks and real Chromium desktop/mobile tests.

## Goal bank

Goals & targets → **Browse goal bank · 2,000 templates** opens the imported spreadsheet library for administrators and BCBAs. Search by ID/skill/goal text and filter by 40 domains or six source stages. Choose a client, review a template and edit its goal/criteria before saving. New drafts start as Not Started; source ID, original measurement guidance, prompt expectation and clinical notes are retained. Targets and observations are never created automatically. RBT/BT access to the bank API is denied. See data/README.md for source provenance.

Client profiles now embed Goals & Targets directly: **Add from library to this treatment** keeps the current client selected. Optional AI target drafts have a separate edit/review/save step; remaining drafts can be reviewed one by one. AI generation is disabled until an approved API account is connected and explicitly enabled. See [AI target draft setup and privacy](docs/AI_TARGET_DRAFTS.md).

Staff invitations let therapists set their own passwords. Gmail/Workspace SMTP setup and secure manual-link fallback are documented in [Email invitations](docs/EMAIL_INVITATIONS.md). Delivery is disabled until a sending account is configured.
