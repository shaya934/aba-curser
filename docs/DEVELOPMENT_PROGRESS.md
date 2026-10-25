
## Therapist invitations — 2026-10-25

Added administrator-issued, expiring single-use password setup invitations for new and existing active staff. Staff creation prepares an invitation; Account access offers resend or a manual setup-link fallback. Gmail/Workspace SMTP is supported with App Passwords and explicit accepted/failed/not-configured feedback. No email credentials exist in Production; no real therapist emails have been sent or claimed as delivered. Existing accounts and passwords are preserved by deployment.

Security: SHA-256 token hashes, 48-hour expiry, fragment-based links, atomic one-time consumption, session revocation after acceptance, invalidation on email/password/deactivation changes, same-org admin authorization, issuance/acceptance limits, and RLS/revoked public REST grants on the new table. Invitations contain no client information or passwords.

Validation: 34/34 service tests passed, production build and Prisma trace checks passed, desktop/mobile invitation create→set-password→login→replay-rejected tests passed (2/2), TypeScript passed. Initial browser runs exposed test selector issues (required-field asterisk and Next route-announcer alert); selectors corrected and both passed. SMTP success/failure is mocked in tests; actual Gmail inbox delivery remains pending sender credentials and a real recipient check. Hosted migration 202610250008_staff_invitations applied successfully without changing existing accounts.
