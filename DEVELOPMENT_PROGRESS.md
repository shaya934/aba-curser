# Development progress

Specification: ABA Therapy Codex Master Development Plan (user-supplied PDF). All development and tests use synthetic data.

Seven sequential phases: foundation; profiles; scheduling; goals; data collection; PDF reports; integration. Test results are recorded only after execution. No production readiness or HIPAA compliance is implied.

## Phase 1 — Foundation (complete)
Next.js/React/TypeScript/Tailwind workspace, responsive navigation, PostgreSQL schema and migrations, Prisma PostgreSQL driver adapter, salted scrypt passwords, hashed expiring session cookies, login rate limits, CSRF origin checks, backend roles and tenant/assignment scope, synthetic seed accounts.

Validation: 4/4 tests passed (passwords, role denial, missing authentication, database-backed login/logout/client scope); TypeScript passed; production build passed. Live HTTP checks passed for login page, sign-in, authorized dashboard, and workspace navigation. Migration applied to PostgreSQL 17; seed executed. Prisma's binary host is blocked, so checked-in SQL is applied transactionally via `scripts/migrate.ts`; Prisma client generation uses its JS driver engine.

## Phase 2 — Client and staff profiles (complete)
Client and staff CRUD through validated, authorized APIs and profile forms; employment/certification/authorization metadata; care-team assignment and revocation; client tabs; private AES-256-GCM document storage with type/size validation; staff document access; agency settings and audit activity.

Validation: 6/6 cumulative tests passed, including real database profile creation, assignment scope/revocation, encrypted file round-trip, denied downloads, and MIME spoof rejection. TypeScript and production build passed; migration rerun was idempotent. Live authenticated profile/staff/documents/settings API smoke checks passed; unauthenticated access returned 401. Schedule, goals, sessions and progress tabs are connected to APIs implemented in subsequent phases.

## Phase 3 — Scheduling (complete)
Daily/weekly/monthly responsive calendars, client/therapist/status filters, assigned-therapist scheduling, occurrence rescheduling, cancellation/no-show/restore, recurring daily/weekly rules (up to 52 occurrences), status tracking and session entry links. Organization-scoped transaction locks prevent races when booking overlapping client or therapist time. IANA timezones and calendar arithmetic preserve wall times across DST; repeated/gap local times are rejected explicitly.

Validation: 8/8 cumulative service/database tests passed; concurrent booking test admitted exactly one appointment; recurrence/DST checks passed; TypeScript, idempotent migrations and production build passed. Chromium browser navigation, authentication, day/month switching and no horizontal overflow passed on desktop and mobile (2/2 browser tests).

## Phase 4 — Goals and targets (complete)
Configurable goal/target forms, clinical domains, baseline and mastery criteria, all six measurement types, lifecycle statuses and mastery timestamps. Definition changes retain immutable versions; optimistic version checks prevent lost updates. Assigned BCBAs and administrators manage definitions; RBTs/BTs have read access only.

Validation: 9/9 cumulative tests passed, including all measurement types, relationships, two-version history, stale-edit rejection, RBT write denial and unassigned BCBA denial. TypeScript, production build and idempotent migrations passed. Real Chromium goal and frequency-target creation forms passed on desktop and mobile (2/2 phase-specific browser tests).

## Phase 5 — Live clinical sessions (complete)
Appointment-to-session start, dedicated therapist workspace, authorized active-target data collection for all six measurement types, numerator/denominator calculations, server-timestamped measurements, retry keys, audit-preserving correction, durable server timers, serialized autosaving notes with optimistic revision checks and navigation guards, attestation, read-only completion, optional separate-clinician approval, and versioned amendments. Finalization transactionally enqueues an immutable report snapshot; PDF rendering follows in phase 6.

Validation: 11/11 cumulative service/database tests passed, including retry collisions, measurement mismatch, persistence, 75% from 3/4, actual duration, timer recovery, stale-note rejection, voiding, completion restrictions, approval and preserved original amendment versions. Production build passed and TypeScript passed again after browser-loader compatibility correction. The timer migration applied successfully. Chromium therapist workflow passed on desktop and mobile (2/2): trials, count, autosaved note after reload, running timer after reload, stop, attestation, finalized read-only session and one report job.

## Phase 6 — Automatic PDF reports (complete)
Server-generated paginated branded PDFs with embedded Unicode font; client/session/therapist/credential identity, scheduled/actual times, duration, location, goals/targets and definition versions, individual measurements, prompted responses, factual summaries, entered notes/observations, attestation and approval. Private encrypted downloads are checked against tenant and current assignment. Finalization uses a transactional outbox snapshot; generation locks prevent duplicate artifacts on concurrent retries; failures remain visible and retryable. A small recovery worker handles pending/failed jobs after restarts. Amendment versions preserve original reports. Client/global Documents include session PDFs.

Validation: 12/12 cumulative tests passed; actual PDF text extraction verified session identity, client ID, prompted data, 75.00% and entered notes. Simulated encryption-key failure retained the finalized session/job; concurrent retries produced one stored report with expected attempt count. Unauthorized download denied; v1 preserved after v2 amendment. TypeScript, migration rerun and production build passed. Chromium auto-finalize/generate/download workflow passed on desktop and mobile (2/2).
