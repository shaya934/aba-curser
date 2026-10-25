'use client';
import { useState } from 'react';
import { api, useData, Notice } from './common';
export default function TargetSuggestions({
  goalId,
  onReview,
  drafts,
  onGenerated,
}: {
  goalId: string;
  drafts: any[];
  onGenerated: (drafts: any[]) => void;
  onReview: (draft: any) => void;
}) {
  const { data, error } = useData<{ configured: boolean; eligible: boolean }>(
    `goals/${goalId}/target-suggestions`,
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  return (
    <div className="stack">
      <p>
        AI drafts require BCBA review. Edit the wording, measurement and mastery criteria before
        saving each target. Baselines and clinical observations are never generated.
      </p>
      <Notice error={error || failure} />
      {data && !data.configured && (
        <p className="muted">
          AI suggestions are not connected yet. An administrator must configure an approved LLM
          account. You can continue adding targets manually.
        </p>
      )}
      {data && !data.eligible && (
        <p className="muted">
          This feature uses only generic library goals, without sending client names, identifiers or
          clinical records. Add this goal from the library to use it.
        </p>
      )}
      <button
        className="primary"
        disabled={!data?.configured || !data.eligible || busy}
        onClick={async () => {
          setBusy(true);
          setFailure('');
          try {
            onGenerated(
              (await api(`goals/${goalId}/target-suggestions`, 'POST', {})).drafts.map(
                (draft: any) => ({ ...draft, draftId: crypto.randomUUID() }),
              ),
            );
          } catch (e) {
            setFailure((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Generating drafts…' : 'Generate target drafts'}
      </button>
      {drafts.map((d, i) => (
        <article className="card" key={i}>
          <h3>{d.name}</h3>
          <p>{d.description}</p>
          <p className="small">
            {d.measurement} · {d.masteryCriteria}
          </p>
          <button onClick={() => onReview(d)}>Edit & review target</button>
        </article>
      ))}
      <p className="small muted">
        Nothing is saved until you review an individual draft and select Save definition.
      </p>
    </div>
  );
}
