'use client';
import GoalBank from './GoalBank';
import { draftFromTemplate } from '@/lib/goal-template';
import { useState } from 'react';
import type { Actor } from '@/lib/auth';
import { api, useData, Form, Modal, Notice, Heading, type Field } from './common';
const statuses = ['Not Started', 'Active', 'Mastered', 'On Hold', 'Discontinued'];
const goalFields: Field[] = [
  { name: 'name', label: 'Goal name', required: true },
  { name: 'domain', label: 'Clinical domain', required: true },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'startDate', label: 'Start date', type: 'date', required: true },
  { name: 'masteryCriteria', label: 'Mastery criteria', type: 'textarea', required: true },
  { name: 'status', label: 'Status', options: statuses, value: 'Active' },
];
const targetFields: Field[] = [
  { name: 'name', label: 'Target name', required: true },
  {
    name: 'measurement',
    label: 'Measurement type',
    options: [
      'Correct/Incorrect',
      'Independent/Prompted',
      'Frequency',
      'Duration',
      'Percentage',
      'Yes/No',
    ],
  },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'baseline', label: 'Baseline' },
  { name: 'masteryCriteria', label: 'Mastery criteria', type: 'textarea', required: true },
  { name: 'status', label: 'Status', options: statuses, value: 'Active' },
];
export default function Goals({ actor }: { actor: Actor }) {
  const { data, error, refresh } = useData<any[]>('goals');
  const clients = useData<any[]>('clients');
  const [client, setClient] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [history, setHistory] = useState<any>(null);
  const canEdit = ['ADMIN', 'BCBA'].includes(actor.role);
  const selected =
    client ||
    (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('client')
      : '') ||
    clients.data?.[0]?.id ||
    '';
  return (
    <div className="stack">
      <Heading
        title="Goals & targets"
        description="Small, intentional steps toward meaningful progress."
        action={
          canEdit && (
            <button
              className="primary"
              disabled={!selected}
              onClick={() => setEditing({ kind: 'goal', value: { clientId: selected } })}
            >
              + New goal
            </button>
          )
        }
      />
      {canEdit && (
        <button onClick={() => setBankOpen(true)}>Browse goal bank · 1,000 templates</button>
      )}
      {bankOpen && (
        <Modal title="Goal bank" close={() => setBankOpen(false)}>
          <GoalBank
            clientId={selected}
            onChoose={(entry) => {
              const d = new Date();
              const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              setBankOpen(false);
              setEditing({ kind: 'goal', value: draftFromTemplate(entry, selected, day) });
            }}
          />
        </Modal>
      )}
      <Notice error={error} />
      <section className="card">
        <label htmlFor="goal-client">Client</label>
        <select id="goal-client" value={selected} onChange={(e) => setClient(e.target.value)}>
          <option value="">Choose client…</option>
          {clients.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </section>
      {data
        ?.filter((g) => g.clientId === selected)
        .map((g) => (
          <section className="card" key={g.id}>
            <div className="row between">
              <div>
                <div className="eyebrow">{g.domain}</div>
                <h2>{g.name}</h2>
                <span className="badge">{g.status}</span>
              </div>
              <div className="row">
                {canEdit && (
                  <>
                    <button onClick={() => setEditing({ kind: 'goal', value: g })}>
                      Edit goal
                    </button>
                    <button
                      className="primary"
                      onClick={() => setEditing({ kind: 'target', goalId: g.id, value: {} })}
                    >
                      + Add target
                    </button>
                  </>
                )}
                <button onClick={() => setHistory({ resource: 'goals', id: g.id })}>History</button>
              </div>
            </div>
            <p className="muted">{g.description}</p>
            <p className="small">
              <strong>Mastery:</strong> {g.masteryCriteria}
            </p>
            {g.targets.map((t: any) => (
              <div className="list-row" key={t.id}>
                <div>
                  <strong>{t.name}</strong>
                  <div className="small muted">
                    {t.measurement} · Baseline: {t.baseline || 'Not entered'}
                  </div>
                  <div className="small">Mastery: {t.masteryCriteria}</div>
                  {t.masteredAt && (
                    <div className="small">
                      Mastered {new Date(t.masteredAt).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <div className="row">
                  <span className="badge">{t.status}</span>
                  {canEdit && (
                    <button onClick={() => setEditing({ kind: 'target', goalId: g.id, value: t })}>
                      Edit target
                    </button>
                  )}
                  <button onClick={() => setHistory({ resource: 'targets', id: t.id })}>
                    History
                  </button>
                </div>
              </div>
            ))}
            {!g.targets.length && (
              <p className="empty">Add targets to make this goal ready for data collection.</p>
            )}
          </section>
        ))}
      {data && !data.some((g) => g.clientId === selected) && (
        <p className="card empty">No goals for this client yet.</p>
      )}
      {editing && (
        <Modal
          title={`${editing.value.id ? 'Edit' : 'New'} ${editing.kind}`}
          close={() => setEditing(null)}
        >
          <Form
            fields={editing.kind === 'goal' ? goalFields : targetFields}
            initial={editing.value}
            submit="Save definition"
            onSave={async (d) => {
              const isGoal = editing.kind === 'goal';
              const value = {
                ...d,
                ...(isGoal ? { clientId: editing.value.clientId || selected } : {}),
                ...(editing.value.id ? { version: editing.value.version } : {}),
              };
              await api(
                editing.value.id
                  ? (isGoal ? 'goals/' : 'targets/') + editing.value.id
                  : isGoal
                    ? 'goals'
                    : `goals/${editing.goalId}/targets`,
                editing.value.id ? 'PATCH' : 'POST',
                value,
              );
              setEditing(null);
              refresh();
            }}
          />
        </Modal>
      )}
      {history && (
        <Modal title="Clinical definition history" close={() => setHistory(null)}>
          <History resource={history.resource} id={history.id} />
        </Modal>
      )}
    </div>
  );
}
function History({ resource, id }: { resource: string; id: string }) {
  const { data, error } = useData<any[]>(`${resource}/${id}/history`);
  return (
    <div>
      <Notice error={error} />
      {data?.map((h) => (
        <div className="card" key={h.id} style={{ marginBottom: 12 }}>
          <h3>
            Version {h.version} · {new Date(h.createdAt).toLocaleString()}
          </h3>
          <p>
            {h.snapshot.name} · {h.snapshot.status}
          </p>
          <p className="muted">{h.snapshot.description}</p>
          <p className="small">Mastery: {h.snapshot.masteryCriteria}</p>
          {h.snapshot.measurement && <p className="small">Measurement: {h.snapshot.measurement}</p>}
        </div>
      ))}
    </div>
  );
}
