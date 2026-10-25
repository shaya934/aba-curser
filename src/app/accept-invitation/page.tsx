'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/components/common';
export default function AcceptInvitation() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    setToken(window.location.hash.slice(1));
    window.history.replaceState(null, '', window.location.pathname);
  }, []);
  return (
    <main className="login">
      <section className="card login-box">
        <div className="eyebrow">Welcome to Brightpath</div>
        <h1>{done ? 'Your account is ready.' : 'Set your password'}</h1>
        {done ? (
          <>
            <p>Your password was saved. Sign in with your work email.</p>
            <Link className="primary" href="/login">
              Continue to sign in
            </Link>
          </>
        ) : (
          <>
            <p className="muted">Choose your own password to accept your agency’s invitation.</p>
            {!token ? (
              <p role="alert">
                Open the complete invitation link from your email. If needed, ask your administrator
                for a new link.
              </p>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError('');
                  const data = new FormData(e.currentTarget);
                  if (data.get('password') !== data.get('confirm')) {
                    setError('The passwords do not match.');
                    return;
                  }
                  setBusy(true);
                  try {
                    await api('auth/accept-invitation', 'POST', {
                      token,
                      password: data.get('password'),
                    });
                    setDone(true);
                    setToken('');
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div className="field">
                  <label htmlFor="new-password">New password (at least 12 characters)</label>
                  <input
                    id="new-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={256}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="confirm-password">Confirm password</label>
                  <input
                    id="confirm-password"
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={256}
                    required
                  />
                </div>
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <button className="primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Set password'}
                </button>
              </form>
            )}
          </>
        )}
      </section>
    </main>
  );
}
