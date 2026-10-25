'use client';
import { useState } from 'react';
import { api, Modal, useData } from './common';
export type InvitationResult = {
  delivery: 'sent' | 'failed' | 'not_configured';
  invitationUrl: string;
  expiresAt: string;
};
export function InvitationReceipt({
  result,
  close,
}: {
  result: InvitationResult;
  close: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      title={result.delivery === 'sent' ? 'Invitation email sent' : 'Share the account invitation'}
      close={close}
    >
      <p role="status">
        {result.delivery === 'sent'
          ? 'The email server accepted the invitation. Ask the therapist to check their inbox and spam folder.'
          : result.delivery === 'not_configured'
            ? 'Email is not connected yet, so no email was sent. You can share this secure setup link directly with this therapist.'
            : 'The email could not be sent. Check the sending account settings. You can share this secure setup link directly with this therapist.'}
      </p>
      <p className="small muted">
        The therapist sets their own password. This link works once, expires in 48 hours, and
        replaces any previous invitation. Treat it like a password.
      </p>
      <label htmlFor="invitation-link">Private setup link</label>
      <input
        id="invitation-link"
        readOnly
        value={result.invitationUrl}
        onFocus={(e) => e.target.select()}
      />
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(result.invitationUrl);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Copied' : 'Copy invitation link'}
      </button>
    </Modal>
  );
}
export default function StaffInvitation({ userId, active }: { userId: string; active: boolean }) {
  const { data } = useData<{ configured: boolean }>('staff/invitation-settings');
  const [result, setResult] = useState<InvitationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="card">
      <h2>Account access</h2>
      <p>
        {data?.configured
          ? 'Send an invitation so this therapist can set their own password. Resending replaces the previous link.'
          : 'Email invitations are not connected. Create a private setup link to share directly with this therapist.'}
      </p>
      {!active && <p>Activate this staff account before sending an invitation.</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={busy || !active}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            setResult(await api(`staff/${userId}/invitation`, 'POST', {}));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Preparing…' : data?.configured ? 'Send / resend invitation' : 'Create setup link'}
      </button>
      {result && <InvitationReceipt result={result} close={() => setResult(null)} />}
    </section>
  );
}
