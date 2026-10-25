# Therapist account invitations

Administrators can add an active staff member without choosing a password. An invitation is prepared automatically. Existing active staff profiles have an Account access section to send/resend an invitation or create a setup link. No existing staff receive emails simply because this code is deployed.

The app reports whether the SMTP server accepted the message, rejected/failed, or is not configured. SMTP acceptance does not guarantee inbox delivery; check spam and the sending account's restrictions. If email is unavailable, administrators can copy the private one-time setup link and share it directly with its intended recipient. Resending invalidates the previous link. Never publish invitation links or passwords.

## Gmail / Google Workspace

1. Choose the existing account that should send invitations.
2. Enable 2-Step Verification in that Google account's Security settings.
3. Open https://myaccount.google.com/apppasswords and generate an App Password for Brightpath. Workspace administrators may disable App Passwords; use an approved SMTP service instead if unavailable. Do not use the normal Google sign-in password.
4. In Vercel → aba-curser → Environment Variables, add these for Production:
   - `SMTP_USER`: the full sending Gmail/Workspace email address.
   - `SMTP_PASSWORD`: the generated 16-character App Password without spaces; mark Sensitive.
   - `SMTP_HOST`: `smtp.gmail.com` (also the default).
   - `SMTP_PORT`: `465` (also the default).
5. Redeploy the current working production deployment. Then open an existing staff profile → Account access → Send / resend invitation. Check the recipient's inbox/spam. No paid email provider is introduced by this implementation; existing Google account sending limits still apply.

Secrets belong only in server environment variables, never in chat, GitHub, or `NEXT_PUBLIC_` variables.

## Security and limitations

Invitations contain no client information or passwords. Tokens are random 256-bit values, stored only as SHA-256 hashes, expire after 48 hours, and are consumed atomically once. The token is placed in the URL fragment to avoid sending it in HTTP URLs/access logs. Password acceptance revokes existing login sessions. Changing a staff email, resetting their password, or deactivating them invalidates outstanding invitations. Only administrators in the same organization can issue invitations; rate limits apply. The new table denies Supabase public REST access.

Automatic creation uses an unguessable initial password if the admin leaves the optional password blank. The user must then accept an invitation before signing in. Existing manual initial-password logins still work. This is an administrator-issued invitation/reset flow, not a public forgot-password flow. Unsigned public users cannot request emails or enumerate accounts.

Tests use synthetic staff and mocked SMTP acceptance/failure; actual Gmail delivery requires the account configuration above and a real inbox check. Email delivery is synchronous with a bounded timeout and explicit failure display; no paid queue or background infrastructure is required.
