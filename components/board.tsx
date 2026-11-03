'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Board as BoardData, Point, SystemStatus } from '@/lib/board-types';
import { SYSTEMS } from '@/lib/catalogue';
import { TROUBLE } from '@/lib/states';
import { manilaDate } from '@/lib/time';
import { BIR_URL } from '@/lib/site';
import { ReportDialog } from './report-dialog';
import { StatusCard } from './status-card';
import type { Mine } from './timeline';

const POLL_MS = 30_000;
/** How long the reader's own dot is kept if a cached poll does not hold it yet. */
const MINE_MS = 2 * 60_000;

const systemLabel = (key: string) => SYSTEMS.find((s) => s.key === key)?.label ?? key;

type Props = {
  initial: BoardData;
  /** "What to do now", rendered on the server from content/what-to-do.md. */
  whatToDo: React.ReactNode;
};

/**
 * The live board. Polls GET /api/status every 30 seconds (spec §7), no
 * realtime subscription, and skips polls while the tab is hidden.
 */
export function Board({ initial, whatToDo }: Props) {
  const [board, setBoard] = useState(initial);
  const [mine, setMine] = useState<Record<string, Mine>>({});
  const [stale, setStale] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as BoardData;
      // The edge may answer with a copy from before the reader's own report.
      setBoard((prev) => (next.generatedAt >= prev.generatedAt ? next : prev));
      setStale(false);
    } catch {
      setStale(true);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // Forget the reader's own dot once it is old enough to be in every poll.
  useEffect(() => {
    const id = setInterval(() => {
      setMine((m) => {
        const now = Date.now();
        const kept = Object.fromEntries(Object.entries(m).filter(([, v]) => now - v.at < MINE_MS));
        return Object.keys(kept).length === Object.keys(m).length ? m : kept;
      });
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  function onReported(status: SystemStatus | null, generatedAt: string | null, point: Point) {
    if (status && generatedAt) {
      // Server time, like every poll's, so a cached poll from before the report
      // cannot put the old counts back.
      setBoard((b) => ({
        ...b,
        generatedAt,
        systems: b.systems.map((s) => (s.key === status.key ? status : s)),
      }));
    }
    const key = status?.key;
    if (key) setMine((m) => ({ ...m, [key]: { ...point, at: Date.now() } }));
  }

  const trouble = board.systems.some((s) => TROUBLE.includes(s.state));
  const latestAdvisory = board.advisories[0] ?? null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-3xl sm:text-4xl">Is eFPS or eBIRForms working right now?</h1>
        <ReportDialog onReported={onReported} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {board.systems.map((s) => (
          <StatusCard
            key={s.key}
            status={s}
            windowMinutes={board.windowMinutes}
            mine={mine[s.key] ?? null}
            generatedAt={board.generatedAt}
          />
        ))}
      </div>
      <p className="text-sm text-ink-muted -mt-4" role="status">
        {stale
          ? 'The board could not be refreshed just now. It will try again in 30 seconds.'
          : 'Updates every 30 seconds.'}
      </p>

      {trouble && (
        <section aria-labelledby="what-to-do" className="what-to-do">
          <h2 id="what-to-do" className="text-2xl">
            What to do now
          </h2>
          <div className="prose-block">{whatToDo}</div>
          <ul className="flex flex-col gap-1 mt-3">
            {latestAdvisory && (
              <li>
                Latest confirmed BIR advisory:{' '}
                <a href={latestAdvisory.url} target="_blank" rel="noopener">
                  {latestAdvisory.title}
                </a>
              </li>
            )}
            <li>
              The BIR&apos;s own notices: <a href={BIR_URL}>bir.gov.ph</a>
            </li>
          </ul>
        </section>
      )}

      <section aria-labelledby="advisories">
        <h2 id="advisories" className="text-2xl">
          Latest BIR advisories
        </h2>
        {board.advisories.length === 0 ? (
          <p className="mt-2 text-ink-muted">
            No confirmed advisories yet. Advisories appear here once they are checked against the BIR&apos;s
            own PDF.
          </p>
        ) : (
          <ul className="advisory-list">
            {board.advisories.map((a) => {
              const when = a.issuedOn ?? a.startsAt;
              return (
                <li key={a.id}>
                  <p className="text-sm text-ink-muted">
                    {when ? manilaDate(a.issuedOn ? `${a.issuedOn}T00:00:00+08:00` : when) : 'Date not stated'}
                    {a.systems.length > 0 && <> · {a.systems.map(systemLabel).join(', ')}</>}
                  </p>
                  <p className="font-semibold">
                    <a href={a.url} target="_blank" rel="noopener">
                      {a.title}
                    </a>{' '}
                    <span className="text-sm font-normal text-ink-muted">(PDF)</span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
