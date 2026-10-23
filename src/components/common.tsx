'use client';
import { useEffect, useState, useRef } from 'react';
export async function api<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch('/api/' + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || 'Request failed.');
  return data;
}
export function useData<T = any>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [version, reload] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    api<T>(url)
      .then((x) => {
        if (active) setData(x);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [url, version]);
  return { data, error, refresh: () => reload((x) => x + 1) };
}
export function Notice({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="error">
      {error}
    </p>
  ) : null;
}
export type Field = {
  name: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[] | string[];
  required?: boolean;
  value?: string | number;
};
export function Form({
  fields,
  initial = {},
  submit,
  onSave,
  children,
}: {
  fields: Field[];
  initial?: Record<string, any>;
  submit: string;
  onSave: (data: any) => Promise<void>;
  children?: React.ReactNode;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const data = Object.fromEntries(new FormData(e.currentTarget));
        try {
          await onSave(data);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid">
        {fields.map((f) => (
          <div className="field" key={f.name}>
            <label htmlFor={'field-' + f.name}>
              {f.label}
              {f.required ? ' *' : ''}
            </label>
            {f.options ? (
              <select
                id={'field-' + f.name}
                name={f.name}
                defaultValue={initial[f.name] ?? f.value ?? ''}
                required={f.required}
              >
                {f.options.map((o) =>
                  typeof o === 'string' ? (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ) : (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ),
                )}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea
                id={'field-' + f.name}
                name={f.name}
                defaultValue={initial[f.name] ?? f.value ?? ''}
                required={f.required}
                maxLength={5000}
              />
            ) : (
              <input
                id={'field-' + f.name}
                name={f.name}
                type={f.type || 'text'}
                defaultValue={f.type === 'password' ? '' : (initial[f.name] ?? f.value ?? '')}
                required={f.required}
                min={f.type === 'number' ? 0 : undefined}
                minLength={f.type === 'password' ? 12 : undefined}
                maxLength={f.type === 'password' ? 256 : 5000}
              />
            )}
          </div>
        ))}
      </div>
      {children}
      <Notice error={error} />
      <button disabled={busy} className="primary">
        {busy ? 'Saving…' : submit}
      </button>
    </form>
  );
}
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const root = ref.current;
    root?.querySelector<HTMLElement>('button,input,select,textarea')?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const els = Array.from(
          root?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,textarea,a[href]',
          ) || [],
        );
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      prev?.focus();
    };
  }, [close]);
  return (
    <div className="modal-backdrop">
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between" style={{ marginBottom: 20 }}>
          <h2>{title}</h2>
          <button aria-label="Close dialog" onClick={close}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Heading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">CONNECTED CARE</div>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
