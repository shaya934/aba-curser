# Limitations and pre-production work

The seven development phases provide a working local application and verified synthetic workflows. This document separates application behavior from operational and clinical readiness.

## Deployment and health information

- **No HIPAA-compliance claim.** Real patient use requires clinical validation, privacy/security review, appropriate BAAs, vendor eligibility, access policy, workforce training, incident response, legal retention rules, risk assessment and recovery drills.
- This development environment uses local PostgreSQL and AES-256-GCM encrypted files. A configurable private S3-compatible backend and Vercel deployment guide are implemented, but hosted resources have not been provisioned or validated. Production requires TLS at ingress/database connections, encrypted database disks/backups, key custody/rotation, private durable object storage (or an appropriately encrypted shared volume), and hardened, monitored hosting. These external services/agreements were not provisioned. No paid services were introduced.
- Password authentication supports salted scrypt, server-only hashed session tokens, eight-hour expiry, account deactivation/revocation and rate limits. MFA, SSO, self-service account recovery and external identity provisioning are not included. Administrator staff forms support password changes. Provision the first production admin through a controlled operator workflow; never ship synthetic seed users.
- The CSP restricts origins and embedding; Next.js inline hydration currently requires `unsafe-inline`. Development also needs `unsafe-eval`. A nonce-based production CSP and independent penetration testing remain deployment hardening work.
- Logs intentionally exclude clinical payloads. Audit metadata covers sign-in, record changes, measurements, attestation/approval, document/report downloads and retry actions. Before production, apply access-controlled immutable log export, monitoring, retention and a documented audit-review process.
- Files are limited to 3 MB PDF/PNG/JPEG with extension-independent MIME magic checks and private attachment downloads. Full malware scanning, antivirus/sandbox scanning, PDF active-content sanitization and organizational quarantine policy are not implemented. Never open untrusted files outside an appropriately protected viewer.
- No automated clinical-data deletion is exposed. Inactive status archives profiles; signed sessions and report versions are retained. A legally reviewed purge/legal-hold workflow, verified backup schedule and storage lifecycle policy must be established before patient use.

## Deliberate functional boundaries

- One agency per authenticated user; strict tenant/assignment isolation. There is no public organization signup or cross-agency account switcher. Organization/role administration is intentionally restricted to trusted administrators.
- Recurrence is daily or weekly with an explicit horizon of 52 occurrences. Individual occurrences can be rescheduled/cancelled/restored. Advanced recurrence patterns and bulk-series editing are not included. Ambiguous DST repeated hours require choosing an unambiguous local time.
- There is no offline recording or PHI in browser local storage. Running timers and acknowledged entries survive reload/navigation. Unsaved note/action states show warnings and navigation guards; closing a browser forcibly or losing a device before an action reaches the server cannot preserve an unsubmitted observation. Reconcile data after uncertain connectivity before adding new measurements.
- Definition snapshots are retained per measurement, including timer start. Definition edits require current version numbers. Conflicting note edits from multiple windows require manual reconciliation to avoid lost clinical observations.
- Finalized measurement data is immutable through the API. Clinical amendments append a corrected note/reason and new PDF version while preserving original entries. Correct a mistaken raw measurement by voiding before finalization; post-finalization measurement corrections should be described in the versioned amendment rather than rewriting signed evidence.
- Only the assigned session therapist can start/record/attest; administrators can review and administer access but cannot impersonate the treating therapist.
- Attestation and supervisor approval store authenticated identity/time. They are not a cryptographic digital-signature or external electronic-signature integration.
- PDF template supports agency name, therapist credentials and an embedded DejaVu Unicode font. Custom agency PNG/JPEG logos are supported; arbitrary branding layouts, full complex-script/bidirectional layout and scripts outside the font's glyph coverage are not implemented.
- Progress displays factual session aggregates. Predictive clinical interpretation, billing, payroll, parent portals, AI-generated clinical notes and the PDF's future expansion modules are intentionally excluded.

## Operations and testing limits

- Single Next.js application, PostgreSQL and private local/S3-compatible storage; no message broker. Local installations can run the lightweight report worker. Vercel uses an authenticated daily cron endpoint that recovers one job per invocation; normal finalization still generates immediately. Review plan limits/costs before selecting hosted services or increasing cron frequency. Automatic recovery stops after five failed attempts, with visible authorized manual retry. A crash between file write and transaction commit may leave an orphan encrypted blob requiring safe reconciliation.
- Native Prisma CLI engine downloads are blocked by this cloud policy. The tested setup uses Prisma's pinned generator API plus JavaScript PostgreSQL adapter and checked-in SQL migration runner. Revalidate `scripts/generate.ts` when upgrading Prisma internals. No checksum/TLS validation was disabled.
- Synthetic Chromium desktop/mobile, database, HTTP and PDF-text tests were run in this cloud instance. They are not a substitute for assistive-technology user testing, real-device testing, clinical acceptance, load testing, disaster recovery in a production host, or validation of a restored environment snapshot.
- GitHub API access is subject to the task's network policy. Git push and PR creation outcomes are recorded in DEVELOPMENT_PROGRESS.md; a pushed branch alone does not prove a PR exists.

- Vercel preparation has been tested locally, including the S3 HTTP protocol against an emulator. A real hosted PostgreSQL/S3/Vercel deployment still needs user-selected providers, securely configured credentials, operator migrations/first administrator, and the hosted smoke checks in docs/VERCEL_DEPLOYMENT.md. No deployment or paid subscription was created.

## Hosted status (October 25, 2026)

A Vercel/Supabase deployment now exists at https://aba-curser.vercel.app. Hosted authentication, database-backed dashboard, anonymous denial, PDF rendering and encrypted storage smoke checks passed with synthetic technical data. Earlier statements about unprovisioned hosting describe the earlier development phase. This does not verify every clinical workflow on the hosted instance or establish HIPAA compliance, BAA eligibility, commercial plan eligibility, clinical approval or backup/recovery operations. Use synthetic data until those reviews are complete.
