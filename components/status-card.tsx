'use client';

import { useEffect, useRef, useState } from 'react';
import type { SystemStatus } from '@/lib/board-types';
import { STATE_COPY, type State } from '@/lib/states';
import { manilaWhen } from '@/lib/time';
import { Timeline, type Mine } from './timeline';

/** "12 failed, 3 worked in the last hour", the sentence behind every state (spec §5). */
export function countsLine(s: Pick<SystemStatus, 'ok' | 'fail'>): string {
  if (s.ok + s.fail === 0) return 'No reports in the last hour';
  return `${s.fail} failed, ${s.ok} worked in the last hour`;
}

/** Each state has its own shape as well as its colour, so neither carries it alone. */
function StateIcon({ state }: { state: State }) {
  const common = { width: 28, height: 28, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false } as const;
  switch (state) {
    case 'up':
      return (
        <svg {...common} className="text-success">
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="var(--on-success)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'issues':
      return (
        <svg {...common} className="text-warning">
          <path d="M12 2.5L22.5 21h-21z" fill="currentColor" strokeLinejoin="round" />
          <path d="M12 9v5.5" stroke="var(--on-warning)" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="12" cy="17.6" r="1.4" fill="var(--on-warning)" />
        </svg>
      );
    case 'down':
      return (
        <svg {...common} className="text-danger">
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="var(--on-danger)" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );
    case 'official_down':
      return (
        <svg {...common} className="text-danger">
          <rect x="3" y="2" width="18" height="20" rx="2.5" fill="currentColor" />
          <path d="M7 7h10M7 11h10M7 15h6" stroke="var(--on-danger)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common} className="text-ink-muted">
          <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3.2 3" />
          <path d="M8 12h8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );
  }
}

type Props = {
  status: SystemStatus;
  windowMinutes: number;
  mine: Mine | null;
  generatedAt: string;
};

export function StatusCard({ status: s, windowMinutes, mine, generatedAt }: Props) {
  const copy = STATE_COPY[s.state];
  const counts = countsLine(s);

  // The headline cross-fades when the state changes, not on first paint.
  const first = useRef(s.state);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (s.state !== first.current) setChanged(true);
  }, [s.state]);

  const forms = s.topForms.filter((f) => f.fails > 0);

  return (
    <section aria-labelledby={`sys-${s.key}`} className="status-card" data-state={s.state}>
      <h2 id={`sys-${s.key}`} className="text-xl">
        {s.label}
      </h2>

      <div key={s.state} className={changed ? 'state-line is-changed' : 'state-line'}>
        <StateIcon state={s.state} />
        <p className="text-2xl font-extrabold leading-tight">{copy.headline}</p>
      </div>

      {s.state === 'official_down' ? (
        <p className="mt-1">
          {s.advisory ? (
            <>
              The BIR has posted that {s.label} is unavailable:{' '}
              <a href={s.advisory.url} target="_blank" rel="noopener">
                {s.advisory.title}
              </a>
              .
            </>
          ) : (
            <>The BIR has posted that {s.label} is unavailable.</>
          )}
        </p>
      ) : (
        <p className="mt-1">{copy.subline}</p>
      )}

      {s.state === 'no_data' && s.lastKnown && (
        <p className="text-sm text-ink-muted mt-1">
          Last known: {STATE_COPY[s.lastKnown.state].headline}, {manilaWhen(s.lastKnown.at, generatedAt)}.
        </p>
      )}

      <dl className="card-facts">
        <div>
          <dt>Reports</dt>
          <dd>{counts}</dd>
        </div>
        <div>
          <dt>Latest report</dt>
          <dd>{s.latestReportAt ? manilaWhen(s.latestReportAt, generatedAt) : 'None yet'}</dd>
        </div>
        {forms.length > 0 && (
          <div>
            <dt>Failing most</dt>
            <dd>
              {forms.map((f) => `${f.form} (${f.fails})`).join(', ')}
              {s.topFailure && <>, mostly “{s.topFailure.label}”</>}
            </dd>
          </div>
        )}
        {forms.length === 0 && s.topFailure && (
          <div>
            <dt>Failing most</dt>
            <dd>“{s.topFailure.label}”</dd>
          </div>
        )}
      </dl>

      <Timeline
        systemKey={s.key}
        label={s.label}
        points={s.points}
        windowMinutes={windowMinutes}
        mine={mine}
        advisory={s.state === 'official_down' ? s.advisory : null}
        summary={counts}
        dataVersion={generatedAt}
      />
    </section>
  );
}
