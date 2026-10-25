'use client';
import { useState } from 'react';
import { useData, Notice } from './common';
import type { GoalTemplate } from '@/lib/goal-bank';
export default function GoalBank({
  clientId,
  onChoose,
}: {
  clientId: string;
  onChoose: (entry: GoalTemplate) => void;
}) {
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState('');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ q, domain, level, page: String(page) });
  const { data, error } = useData<ReturnType<typeof import('@/lib/goal-bank').searchGoalBank>>(
    'goal-bank?' + params,
  );
  return (
    <div className="stack">
      <p className="muted">
        2,000 reusable templates. Review and individualize for the client before saving. Selecting a
        template opens a draft; no clinical observations or targets are created.
      </p>
      <div>
        <label htmlFor="bank-search">Search goal bank</label>
        <input
          id="bank-search"
          value={q}
          maxLength={200}
          placeholder="Search skill, goal text or ABA ID…"
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <div className="grid">
        <div>
          <label htmlFor="bank-domain">Domain</label>
          <select
            id="bank-domain"
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All domains</option>
            {data?.domains.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="bank-level">Level</label>
          <select
            id="bank-level"
            value={level}
            onChange={(e) => {
              setLevel(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All levels</option>
            {data?.levels.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </div>
      </div>
      <Notice error={error} />
      {!clientId && (
        <p className="muted">Choose a client on Goals & targets before applying a template.</p>
      )}
      <p role="status">
        {data
          ? `${data.total} matching templates · Page ${data.page} of ${data.totalPages}`
          : 'Loading templates…'}
      </p>
      {data?.items.map((e) => (
        <article className="card" key={e.id}>
          <div className="eyebrow">
            {e.id} · {e.domain}
          </div>
          <h3>
            {e.skill} · {e.level}
          </h3>
          <p>{e.goal}</p>
          <p className="small">
            <strong>Mastery:</strong> {e.masteryCriteria}
          </p>
          <p className="small">
            <strong>Measurement:</strong> {e.measurement}
          </p>
          <details>
            <summary>Prompt guidance & clinical notes</summary>
            <p>{e.promptExpectation}</p>
            <p>{e.clinicalNotes}</p>
          </details>
          <button
            className="primary"
            disabled={!clientId}
            onClick={() => onChoose(e)}
            style={{ marginTop: 12 }}
          >
            Review template
          </button>
        </article>
      ))}
      {data?.total === 0 && (
        <p className="empty">No matching templates. Try another search or filter.</p>
      )}
      <div className="row between">
        <button disabled={!data || data.page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <button
          disabled={!data || data.page >= data.totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
