'use client';

import { useEffect, useRef, useState } from 'react';
import type { Point, SystemStatus } from '@/lib/board-types';
import { FAILURE_TYPES, FORM_CODES, SYSTEMS, type SystemKey } from '@/lib/catalogue';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptLoading: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptLoading = null;
      reject(new Error('turnstile'));
    };
    document.head.appendChild(s);
  });
  return scriptLoading;
}

type Props = {
  onReported: (status: SystemStatus | null, generatedAt: string | null, mine: Point) => void;
};

type Phase = { kind: 'form' } | { kind: 'sending' } | { kind: 'done' } | { kind: 'error'; message: string };

/**
 * Spec §6: system, outcome, what happened, optionally the form, an invisible
 * spam check, send. One screen on a phone. It sits in a modal dialog so the
 * board can keep updating behind it without moving anything inside it.
 */
export function ReportDialog({ onReported }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const widgetEl = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [system, setSystem] = useState<SystemKey | ''>('');
  const [outcome, setOutcome] = useState<'ok' | 'fail' | ''>('');
  const [failure, setFailure] = useState('');
  const [form, setForm] = useState('');
  const [token, setToken] = useState('');
  const [checkFailed, setCheckFailed] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });

  const failures = FAILURE_TYPES.filter((f) => system && (f.systems as readonly string[]).includes(system));
  // A failure picked for one system may not exist on the other.
  useEffect(() => {
    if (failure && !failures.some((f) => f.key === failure)) setFailure('');
  }, [system]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !SITE_KEY || !widgetEl.current) return;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !widgetEl.current || !window.turnstile || widgetId.current) return;
        widgetId.current = window.turnstile.render(widgetEl.current, {
          sitekey: SITE_KEY,
          action: 'report',
          appearance: 'interaction-only',
          callback: (t: string) => {
            setToken(t);
            setCheckFailed(false);
          },
          'expired-callback': () => setToken(''),
          'error-callback': () => {
            setToken('');
            setCheckFailed(true);
          },
        });
      })
      .catch(() => setCheckFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open]);

  function show() {
    setPhase({ kind: 'form' });
    setOpen(true);
    dialog.current?.showModal();
  }

  function close() {
    dialog.current?.close();
  }

  function onClose() {
    setOpen(false);
    if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
    widgetId.current = null;
    setToken('');
    if (phase.kind === 'done') {
      setOutcome('');
      setFailure('');
      setForm('');
    }
  }

  const ready = !!system && !!outcome && (outcome === 'ok' || !!failure) && !!token;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setPhase({ kind: 'sending' });
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_key: system,
          outcome,
          failure_type: outcome === 'fail' ? failure : null,
          form_code: form || null,
          turnstile_token: token,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; status?: SystemStatus | null; generatedAt?: string };
      if (res.ok && json.ok) {
        const ms = Date.now();
        onReported(json.status ?? null, json.generatedAt ?? null, {
          t: new Date(ms - (ms % 60_000)).toISOString(),
          outcome: outcome as 'ok' | 'fail',
          form: form || null,
          failure: outcome === 'fail' ? failure : null,
        });
        setPhase({ kind: 'done' });
      } else {
        setPhase({ kind: 'error', message: json.error ?? 'Your report could not be sent. Please try again.' });
      }
    } catch {
      setPhase({ kind: 'error', message: 'Your report could not be sent. Check your connection and try again.' });
    } finally {
      // A token is good for one check only.
      setToken('');
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    }
  }

  return (
    <>
      <button type="button" onClick={show} className="btn-primary">
        Report my filing
      </button>

      <dialog ref={dialog} onClose={onClose} aria-labelledby="report-title" className="report-dialog">
        {phase.kind === 'done' ? (
          <div className="flex flex-col gap-4">
            <h2 id="report-title" className="text-2xl">
              Thanks, your report is counted
            </h2>
            <p>Your dot is on the board, marked “you”. It counts towards the last hour for everyone.</p>
            <button type="button" onClick={close} className="btn-primary self-start" autoFocus>
              Back to the board
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
              <h2 id="report-title" className="text-2xl">
                Report my filing
              </h2>
              <button type="button" onClick={close} className="btn-quiet" aria-label="Close">
                Close
              </button>
            </div>

            <fieldset>
              <legend className="field-label">Which system?</legend>
              <div className="choice-row">
                {SYSTEMS.map((s) => (
                  <label key={s.key} className="choice">
                    <input
                      type="radio"
                      name="system"
                      value={s.key}
                      checked={system === s.key}
                      onChange={() => setSystem(s.key)}
                      required
                    />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="field-label">Did it work?</legend>
              <div className="choice-row">
                <label className="choice">
                  <input type="radio" name="outcome" value="ok" checked={outcome === 'ok'} onChange={() => setOutcome('ok')} required />
                  <span>It worked</span>
                </label>
                <label className="choice">
                  <input type="radio" name="outcome" value="fail" checked={outcome === 'fail'} onChange={() => setOutcome('fail')} />
                  <span>It failed</span>
                </label>
              </div>
            </fieldset>

            {outcome === 'fail' && (
              <label className="flex flex-col gap-1">
                <span className="field-label">What happened?</span>
                <select
                  value={failure}
                  onChange={(e) => setFailure(e.target.value)}
                  required
                  disabled={!system}
                  className="field"
                >
                  <option value="">{system ? 'Choose one' : 'Choose a system first'}</option>
                  {failures.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="flex flex-col gap-1">
              <span className="field-label">
                Which form? <span className="font-normal text-ink-muted">(optional)</span>
              </span>
              <select value={form} onChange={(e) => setForm(e.target.value)} className="field">
                <option value="">Not saying</option>
                {FORM_CODES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>

            <div ref={widgetEl} />
            {!SITE_KEY && <p className="text-sm text-danger">Reporting is not switched on yet.</p>}
            {checkFailed && (
              <p className="text-sm text-danger">The spam check did not load. Reload the page and try again.</p>
            )}

            <p role="status" aria-live="polite" className="text-sm min-h-5">
              {phase.kind === 'error' && <span className="text-danger">{phase.message}</span>}
              {phase.kind === 'sending' && 'Sending…'}
              {phase.kind === 'form' && system && outcome && !token && SITE_KEY && !checkFailed && 'Checking you are a person…'}
            </p>

            <button type="submit" className="btn-primary" disabled={!ready || phase.kind === 'sending'}>
              Send my report
            </button>
            <p className="text-xs text-ink-muted">
              No name, TIN or contact details. See <a href="/about#privacy">how reports are kept</a>.
            </p>
          </form>
        )}
      </dialog>
    </>
  );
}
