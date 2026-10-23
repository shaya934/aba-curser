# Deploying BrightPath on Vercel

The repository now supports Vercel's Node.js functions, pooled PostgreSQL and private S3-compatible storage. No paid services were provisioned and no public deployment was made. Choose providers/plans and check costs before creating resources. Use synthetic data until clinical, security and contractual review is complete; this guide does not establish HIPAA eligibility or compliance.

## What you need

1. A Vercel project connected to this GitHub repository.
2. A hosted PostgreSQL database, with a pooled runtime connection URL and a **direct** migration URL, both using verified TLS. Pick a database region near the Vercel function region. Do not disable certificate verification or add `rejectUnauthorized=false`/`uselibpqcompat=true` to get a connection working.
3. A private S3-compatible bucket (AWS S3 or a compatible provider of your choice). Block public bucket/object access and disable website hosting. Enable provider encryption at rest and a reviewed backup/versioning policy. Give the app a dedicated credential restricted to GetObject, PutObject and DeleteObject for `brightpath/*` in that bucket; it does not need bucket administration or public ACL permissions.
4. Two independent random secrets: a 32-byte hex `STORAGE_KEY` and a `CRON_SECRET` of at least 32 characters. You can generate each with `openssl rand -hex 32`. Store them in a password manager and Vercel's environment settings, never in Git or chat.

The S3 backend encrypts every file/PDF/logo with AES-256-GCM before uploading. Bucket objects contain ciphertext only, under random IDs; names and clinical details are not sent as object metadata. Downloads pass through the authenticated application and its tenant/assignment checks. No public or presigned file URLs are exposed. Keep `STORAGE_KEY` backed up separately: replacing it makes existing documents unreadable without a planned re-encryption migration.

## 1. Prepare the hosted database once

Use a trusted terminal (this Codex workspace can be used when authorized credentials are bound) with Node.js 24. This is an operator setup step; it does **not** run the application on your computer.

Create a private, Git-ignored `.env.hosted` file, or inject the variables through your secret manager. Include the pooled `DATABASE_URL`, the `DATABASE_DIRECT_URL`, and these first-account values:

```dotenv
AGENCY_NAME=Your agency name
ADMIN_NAME=Your administrator name
ADMIN_EMAIL=your-administrator-email
ADMIN_PASSWORD=use-a-unique-password-of-at-least-16-characters
```

Use actual values securely; these examples are not credentials to copy. Never reuse the development database/password. Run from the checked-out application directory:

```sh
npm ci
npm run db:generate
node --env-file=.env.hosted --import tsx scripts/migrate.ts
node --env-file=.env.hosted --import tsx scripts/create-admin.ts
```

Migrations use the **direct** URL, because their session-scoped advisory lock is incompatible with transaction poolers. The runtime uses only `DATABASE_URL` and a small per-instance pool. The first-admin command creates one organization/administrator in a transaction, refuses any database with existing accounts, and never prints the password. Repeating it does not overwrite credentials. Subsequent staff accounts are created through the app's administrator screens.

Do **not** run `npm run setup`, `env:init` or `db:seed` against the hosted database: those commands intentionally create local synthetic accounts. Vercel builds never migrate, seed or create accounts. Apply future additive migrations through the same controlled operator step before deploying code that needs them. Keep the direct database credential and bootstrap values out of Vercel runtime settings; remove them from the operator environment after use.

## 2. Import the project and configure Vercel

Import `shaya934/aba-curser` in Vercel. Choose **Next.js**, repository root `./`, Node.js **24.x** and the lockfile's npm install. `vercel.json` supplies the build command `npm run build:vercel`, so no Docker or continuously running worker is needed on Vercel.

The application is currently on the `work` branch in PR #1. You can review/merge the PR yourself and deploy `main`, or select `work` as the Vercel project's production branch in its Git settings and deploy that branch without merging. Do not try to deploy the empty initialization commit on `main`. Changing project Git settings and deploying is a user action; this change did neither automatically.

Choose the project/domain first so you know its application origin (for example `https://your-project.vercel.app`). In Vercel **Settings → Environment Variables**, set the following for the intended deployment environment, then deploy/redeploy:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Hosted **pooled** PostgreSQL URL, with `sslmode=verify-full` (or the provider's verified TLS configuration) |
| `APP_ORIGIN` | Exact HTTPS browser origin, with no trailing slash or path; must match the address you use to sign in |
| `STORAGE_DRIVER` | `s3` |
| `STORAGE_KEY` | Your backed-up 64-character hex encryption key |
| `S3_BUCKET` | Private bucket name |
| `S3_REGION` | Provider region; compatible providers may specify a conventional region such as `auto` |
| `S3_ENDPOINT` | Compatible provider's HTTPS API origin; omit for standard AWS S3 |
| `S3_FORCE_PATH_STYLE` | `true` only when required by your provider; default `false` |
| `S3_ACCESS_KEY_ID` | Dedicated restricted object-storage access key |
| `S3_SECRET_ACCESS_KEY` | Matching object-storage secret |
| `CRON_SECRET` | Independent random secret of at least 32 characters |

Never prefix these with `NEXT_PUBLIC_`. Do not copy `SEED_PASSWORD`, bootstrap account variables or the local `DATABASE_URL` from `.env` into Vercel. The configuration checker fails the build for missing durable storage, invalid keys/secrets, insecure origins/endpoints or non-TLS database URLs. It validates names/formats without printing credentials; it does not prove a provider is reachable or credentials are authorized.

The production origin is intentionally explicit for CSRF protection. If adding a custom domain, update `APP_ORIGIN` and redeploy. Use that one canonical origin for sign-in.

For previews, configure a **separate synthetic database, bucket and encryption key**, and set `APP_ORIGIN` to that preview's exact HTTPS URL before redeploying. Do not let preview branches access production records or share the production bucket. Automatic cron recovery is disabled in preview environments. You can disable unwanted preview deployments in project Git settings. Environment variables are scoped in Vercel; check the scope before saving.

## 3. PDF generation and scheduled recovery

Finalizing/approving/amending a session saves its immutable report job in PostgreSQL, then awaits server-side generation/upload. It does not depend on work continuing after a serverless response. The bundled font is explicitly included in API function tracing.

`vercel.json` registers a **daily** GET to `/api/cron/reports`. Vercel sends `Authorization: Bearer <CRON_SECRET>`. The endpoint denies missing/wrong credentials, rejects previews, returns no clinical payload, and is never publicly triggerable without the secret. It handles **one** pending/failed job per invocation to stay within the configured 60-second Node-function duration. Each report uses a database transaction lock and unique version key to prevent duplicate artifacts. There is no Vercel background loop or external queue service.

Normal sessions generate their PDFs immediately. Daily cron is a recovery safety net, not the primary generation path; one job per day can drain a backlog slowly. Authorized users can retry each report from its session screen. Automatic attempts stop after five failures so a broken provider/key does not retry indefinitely. Investigate repeated failures and use the manual retry after fixing configuration. If you need faster unattended recovery, review Vercel plan limits/costs before changing the cadence or adding a scheduler. No paid plan or more frequent cron was enabled here.

Files are limited to **3,000,000 bytes (3 MB)**. Their base64 JSON request fits below the conservative 4.2 MB application cap and Vercel's documented 4.5 MB function request limit. Larger uploads require a different authenticated streaming/direct-upload design and are deliberately rejected. Node API functions allow up to 60 seconds; exceptionally large/slow PDF generation can still exceed a function budget, leaving a durable job for retry. Check the current limits for your chosen plan:

- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/functions/configuring-functions/duration
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://vercel.com/docs/cron-jobs/manage-cron-jobs

## 4. Verify the deployment with synthetic data

1. Check the build log for successful Prisma client generation and Next.js build. No database mutation should occur during build.
2. Open the configured HTTPS origin and sign in with the first administrator you created. Test sign-out/sign-in and cookie expiry; cookies must be HttpOnly, SameSite=Strict and Secure.
3. Create a synthetic client, BCBA and therapist, assign them, create goals/targets and an appointment, then sign in as the therapist.
4. Record data and notes, navigate/reload, finalize, and download the generated PDF. Verify the factual contents and that the client profile links it. Upload a small synthetic PDF/image and download it again.
5. Sign in as an unassigned staff account; the file/session/report APIs must deny access. Confirm the bucket/object cannot be downloaded anonymously; even a misconfigured public bucket must expose no plaintext (but it must still be made private).
6. In Vercel's Cron Jobs page, inspect the scheduled recovery invocation. A logged-out browser GET to the endpoint must return 401. Never paste the cron secret into a public URL. Do not dump environment values into build/runtime logs.
7. Refresh the site after a new deployment: DB records and object-store files must still exist. Configure provider backups and perform a restore drill before relying on them.

Only after these hosted checks pass should you call the deployment verified. The code changes and local tests do **not** verify a live Vercel instance, actual provider permissions/quotas, paid-plan eligibility, backups or BAAs.

## Existing development data

Local disk storage remains supported for development. If you migrate an existing database to S3, copy its **encrypted object bytes**, preserving UUIDs under `brightpath/<UUID>`, before switching the app to S3; preserve the exact encryption key. Include current/old logo objects referenced by report snapshots. Do not simply switch the driver while the database still references files left only on local disk. No existing files or database data were migrated by this change.

## Repeat the local S3 contract test

The test uses a disposable local HTTP S3 emulator, synthetic credentials, and a temporary bucket. It verifies real SDK HTTP requests, private ciphertext, authenticated decryption/tamper rejection, deletion, PDF recovery and cron authorization. It does not emulate a Vercel deployment or certify a hosted provider.

```sh
python3 -m venv /tmp/aba-s3-test
/tmp/aba-s3-test/bin/pip install 'moto[server]==5.1.14'
/tmp/aba-s3-test/bin/moto_server -H 127.0.0.1 -p 5000
# In another terminal, with the synthetic development PostgreSQL database seeded:
npm run test:storage
```

The GitHub Actions workflow runs these S3 contract checks in addition to service/HTTP and Chromium tests. Unit checks cover cloud configuration, unsafe endpoints, cron credentials, upload limits and migration connection selection. The hosted administrator bootstrap is also checked against a fresh disposable database.
