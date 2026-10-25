'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Actor } from '@/lib/auth';
import { api, useData, Form, Modal, Notice, Heading, type Field } from './common';
import Documents from './Documents';
import Goals from './Goals';
import StaffInvitation, { InvitationReceipt, type InvitationResult } from './StaffInvitation';
const clientFields: Field[] = [
  { name: 'name', label: 'Full name', required: true },
  { name: 'clientCode', label: 'Client ID', required: true },
  { name: 'dob', label: 'Date of birth', type: 'date', required: true },
  { name: 'status', label: 'Status', options: ['Active', 'Inactive'] },
  { name: 'address', label: 'Address' },
  { name: 'guardians', label: 'Guardians' },
  { name: 'contact', label: 'Contact details' },
  { name: 'diagnosis', label: 'Diagnosis' },
  { name: 'insurance', label: 'Insurance' },
  { name: 'authorizationStart', label: 'Authorization starts', type: 'date' },
  { name: 'authorizationEnd', label: 'Authorization ends', type: 'date' },
  { name: 'authorizationHours', label: 'Authorized hours', type: 'number', value: 0 },
];
const staffFields: Field[] = [
  { name: 'name', label: 'Full name', required: true },
  { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'role', label: 'Role', options: ['RBT', 'BT', 'BCBA', 'ADMIN'] },
  { name: 'phone', label: 'Phone' },
  { name: 'title', label: 'Title' },
  { name: 'status', label: 'Employment status', options: ['Active', 'Inactive'] },
  { name: 'startDate', label: 'Start date', type: 'date' },
  { name: 'certification', label: 'Certification number' },
  { name: 'certificationExpiry', label: 'Certification expires', type: 'date' },
  { name: 'npi', label: 'NPI' },
  { name: 'availability', label: 'Availability', type: 'textarea' },
  { name: 'password', label: 'Initial password (12+ characters)', type: 'password' },
];
export default function Profiles({
  kind,
  id,
  actor,
}: {
  kind: 'clients' | 'staff';
  id?: string;
  actor: Actor;
}) {
  const { data, error, refresh } = useData<any[]>(kind);
  const [invitation, setInvitation] = useState<InvitationResult | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [tab, setTab] = useState('Overview');
  const [search, setSearch] = useState('');
  const [assignmentError, setAssignmentError] = useState('');
  const staff = useData<any[]>('staff');
  const item = id ? data?.find((x) => x.id === id) : null;
  const fields = kind === 'clients' ? clientFields : staffFields;
  return (
    <div className="stack">
      <Heading
        title={item?.name || (kind === 'clients' ? 'Clients' : 'Care team')}
        description={
          kind === 'clients'
            ? 'People at the heart of every step forward.'
            : 'Good care starts with a connected team.'
        }
        action={
          actor.role === 'ADMIN' && (
            <button className="primary" onClick={() => setEditing(item || {})}>
              {item ? 'Edit profile' : `+ Add ${kind === 'clients' ? 'client' : 'staff'}`}
            </button>
          )
        }
      />
      <Notice error={error} />
      {invitation && <InvitationReceipt result={invitation} close={() => setInvitation(null)} />}
      {editing && (
        <Modal
          title={`${editing.id ? 'Edit' : 'Add'} ${kind === 'clients' ? 'client' : 'staff'}`}
          close={() => setEditing(null)}
        >
          <Form
            fields={fields.map((f) =>
              f.name === 'password'
                ? {
                    ...f,
                    label: editing.id
                      ? 'New password (leave blank to keep)'
                      : 'Optional initial password (therapist can set their own)',
                    required: false,
                  }
                : f,
            )}
            initial={editing}
            submit="Save profile"
            onSave={async (d) => {
              if (!d.password) delete d.password;
              const saved = await api(
                kind + (editing.id ? '/' + editing.id : ''),
                editing.id ? 'PATCH' : 'POST',
                d,
              );
              setEditing(null);
              if (saved.invitation) setInvitation(saved.invitation);
              refresh();
            }}
          />
        </Modal>
      )}
      {!id ? (
        <>
          <input
            aria-label="Search profiles"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="grid">
            {data
              ?.filter((x) => x.name.toLowerCase().includes(search.toLowerCase()))
              .map((x) => (
                <Link className="card" href={`/${kind}/${x.id}`} key={x.id}>
                  <div className="row between">
                    <div className="avatar">
                      {x.name
                        .split(' ')
                        .map((p: string) => p[0])
                        .slice(0, 2)
                        .join('')}
                    </div>
                    <span className="badge">{x.status}</span>
                  </div>
                  <h2 style={{ marginTop: 18 }}>{x.name}</h2>
                  <p className="muted">
                    {kind === 'clients' ? x.clientCode : x.role + ' · ' + x.email}
                  </p>
                  <div className="small muted">
                    {x.assignments?.length || 0} assigned{' '}
                    {kind === 'clients' ? 'team members' : 'clients'}{' '}
                    <span style={{ float: 'right' }}>Open profile →</span>
                  </div>
                </Link>
              ))}
          </div>
          {data?.length === 0 && (
            <div className="card empty">No {kind} yet. Create a profile to get started.</div>
          )}
        </>
      ) : item ? (
        <>
          {kind === 'staff' && actor.role === 'ADMIN' && (
            <StaffInvitation userId={item.id} active={item.status === 'Active'} />
          )}
          <div className="tabs">
            {(kind === 'clients'
              ? ['Overview', 'Goals & Targets', 'Schedule', 'Sessions', 'Progress', 'Documents']
              : ['Overview', 'Assigned clients', 'Schedule', 'Documents']
            ).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={tab === t ? 'active' : ''}>
                {t}
              </button>
            ))}
          </div>
          {tab === 'Overview' && (
            <div className="grid">
              <section className="card">
                <h2>Profile details</h2>
                {fields
                  .filter((f) => f.name !== 'password')
                  .map((f) => (
                    <div className="list-row" key={f.name}>
                      <span className="muted">{f.label}</span>
                      <strong
                        style={{
                          maxWidth: '65%',
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {String(item[f.name] ?? '') || '—'}
                      </strong>
                    </div>
                  ))}
              </section>
              <section className="card">
                <h2>{kind === 'clients' ? 'Assigned care team' : 'Assigned clients'}</h2>
                {item.assignments?.map((a: any) => (
                  <div className="list-row" key={a.id}>
                    <span>
                      {a.user?.name || a.client?.name}{' '}
                      {a.user?.role && <span className="badge">{a.user.role}</span>}
                    </span>
                    {kind === 'clients' && actor.role === 'ADMIN' && (
                      <button
                        className="danger"
                        onClick={async () => {
                          if (
                            !confirm(
                              'Remove this assignment? Access to this client will be revoked.',
                            )
                          )
                            return;
                          try {
                            await api(`clients/${id}/assignments`, 'POST', {
                              userId: a.user.id,
                              remove: true,
                            });
                            refresh();
                          } catch (e) {
                            setAssignmentError((e as Error).message);
                          }
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {kind === 'clients' && actor.role === 'ADMIN' && (
                  <Form
                    fields={[
                      {
                        name: 'userId',
                        label: 'Add care team member',
                        required: true,
                        options: [
                          { value: '', label: 'Choose staff…' },
                          ...(staff.data || [])
                            .filter((s) => s.status === 'Active')
                            .map((s) => ({ value: s.id, label: s.name + ' · ' + s.role })),
                        ],
                      },
                    ]}
                    submit="Assign staff"
                    onSave={async (d) => {
                      await api(`clients/${id}/assignments`, 'POST', d);
                      refresh();
                    }}
                  />
                )}
                <Notice error={assignmentError} />
              </section>
            </div>
          )}
          {tab === 'Assigned clients' && (
            <div className="card">
              {item.assignments?.map((a: any) => (
                <Link className="list-row" href={'/clients/' + a.client.id} key={a.id}>
                  {a.client.name} →
                </Link>
              ))}
            </div>
          )}
          {tab === 'Documents' && (
            <Documents
              actor={actor}
              clientId={kind === 'clients' ? id : undefined}
              staffId={kind === 'staff' ? id : undefined}
            />
          )}{' '}
          {tab === 'Goals & Targets' && <Goals key={id} clientId={id!} actor={actor} />}
          {tab === 'Schedule' && (
            <Related
              clientId={kind === 'clients' ? id : undefined}
              staffId={kind === 'staff' ? id : undefined}
              resource="appointments"
            />
          )}
          {tab === 'Sessions' && <Related clientId={id} resource="sessions" />}
          {tab === 'Progress' && <Progress clientId={id!} />}
        </>
      ) : data ? (
        <div className="error">Profile not found or access denied.</div>
      ) : (
        <p role="status">Loading profile…</p>
      )}
    </div>
  );
}
function Related({
  clientId,
  staffId,
  resource,
}: {
  clientId?: string;
  staffId?: string;
  resource: string;
}) {
  const { data, error } = useData<any[]>(resource);
  return (
    <section className="card">
      <div className="row between">
        <h2>{resource === 'appointments' ? 'Schedule' : resource}</h2>
        <Link className="button" href={resource === 'appointments' ? '/schedule' : '/' + resource}>
          Open {resource === 'appointments' ? 'schedule' : resource} →
        </Link>
      </div>
      <Notice error={error} />
      {data
        ?.filter(
          (x) => (!clientId || x.clientId === clientId) && (!staffId || x.therapistId === staffId),
        )
        .map((x) => (
          <Link
            key={x.id}
            className="list-row"
            href={
              resource === 'sessions'
                ? '/sessions/' + x.id
                : resource === 'appointments'
                  ? '/schedule'
                  : '/goals?client=' + clientId
            }
          >
            <span>{x.name || new Date(x.start || x.actualStart).toLocaleString()}</span>
            <span className="badge">{x.status}</span>
          </Link>
        ))}
      {data?.length === 0 && <p className="empty">No records yet.</p>}
    </section>
  );
}
function Progress({ clientId }: { clientId: string }) {
  const { data, error } = useData<any>(`clients/${clientId}/progress`);
  return (
    <section className="card">
      <h2>Recorded progress</h2>
      <p className="muted">
        Session summaries from actual entries. No clinical conclusions are inferred.
      </p>
      <Notice error={error} />
      {data?.map((s: any) => (
        <div key={s.id} className="list-row">
          <Link href={'/sessions/' + s.id}>
            {new Date(s.actualStart).toLocaleDateString()} · {s.status}
          </Link>
          <span>{s.summary}</span>
        </div>
      ))}
    </section>
  );
}
