'use client';
import { useState } from 'react';
import { api, useData, Form, Notice, Heading } from './common';
export default function Settings() {
  const { data, error, refresh } = useData<any>('settings');
  const [saved, setSaved] = useState(false);
  return (
    <div className="stack">
      <Heading title="Agency settings" description="A workspace that fits your care team." />
      <Notice error={error} />
      {data && (
        <>
          <section className="card">
            <h2>Organization</h2>
            <Form
              fields={[
                { name: 'name', label: 'Agency name', required: true },
                { name: 'timezone', label: 'Default IANA timezone', required: true },
                {
                  name: 'requireApproval',
                  label: 'Require BCBA review before finalization',
                  options: [
                    { value: 'false', label: 'No' },
                    { value: 'true', label: 'Yes' },
                  ],
                },
              ]}
              initial={{
                ...data.organization,
                requireApproval: String(data.organization.requireApproval),
              }}
              submit="Save settings"
              onSave={async (d) => {
                await api('settings', 'PATCH', {
                  ...d,
                  requireApproval: d.requireApproval === 'true',
                });
                setSaved(true);
                refresh();
              }}
            />
            {saved && (
              <p className="success" role="status">
                Settings saved.
              </p>
            )}
          </section>
          <LogoForm configured={!!data.organization.logoKey} refresh={refresh} />
          <section className="card">
            <h2>Recent audit activity</h2>
            <p className="muted small">
              Activity metadata only. Clinical notes are never included in this log.
            </p>
            {data.audit.map((x: any) => (
              <div className="list-row small" key={x.id}>
                <span>{x.action}</span>
                <span>{new Date(x.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function LogoForm({ configured, refresh }: { configured: boolean; refresh: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <section className="card">
      <h2>Agency logo</h2>
      <p className="muted">
        {configured ? 'An agency logo is configured.' : 'Add a logo for your session reports.'} PNG
        or JPEG, up to 500 KB. Existing report versions keep their original logo.
      </p>
      <Form
        fields={[]}
        submit="Save agency logo"
        onSave={async () => {
          if (!file) throw Error('Choose a PNG or JPEG.');
          if (file.size > 512000) throw Error('Logos must be under 500 KB.');
          const data = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(',')[1]);
            r.onerror = () => reject(Error('Could not read this file'));
            r.readAsDataURL(file);
          });
          await api('settings/logo', 'POST', { mimeType: file.type, data });
          setSaved(true);
          refresh();
        }}
      >
        <div className="field">
          <label htmlFor="agency-logo">Logo file</label>
          <input
            id="agency-logo"
            type="file"
            accept="image/png,image/jpeg"
            required
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>
      </Form>
      {saved && (
        <p className="success" role="status">
          Logo saved for future session reports.
        </p>
      )}
    </section>
  );
}
