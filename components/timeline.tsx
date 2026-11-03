'use client';

import { useEffect, useRef, useState } from 'react';
import type { BoardAdvisory, Point } from '@/lib/board-types';
import { FAILURE_TYPES } from '@/lib/catalogue';
import { manilaTime } from '@/lib/time';

/**
 * The last hour of reports as a strip (docs/board-motion.md): oldest left, now
 * right, "It worked" above the line as hollow dots and "It failed" below it as
 * filled ones, so shape and side say what the colour says.
 *
 * Positions are percentages of the strip's width, which keeps the dots round at
 * any width without measuring anything.
 */

const SLICES = 12;
const HEIGHT = 112;
const MID = 56;
const STEP = 7; // vertical gap between reports in the same minute
const MAX_STACK = 6;

export type Mine = Point & { at: number };

type Props = {
  systemKey: string;
  label: string;
  points: Point[];
  windowMinutes: number;
  /** The reader's own report, kept until it shows up in a poll. */
  mine: Mine | null;
  advisory: BoardAdvisory | null;
  summary: string;
  /** Changes when fresh data lands; with reduced motion the strip only moves then. */
  dataVersion: string;
};

const failureLabel = (key: string | null) => FAILURE_TYPES.find((f) => f.key === key)?.label ?? key;

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduce;
}

const pointKey = (p: Point) => `${p.t}|${p.outcome}|${p.form ?? ''}|${p.failure ?? ''}`;

export function Timeline({ systemKey, label, points, windowMinutes, mine, advisory, summary, dataVersion }: Props) {
  const reduce = useReducedMotion();
  // Null until mounted: the server's clock and the browser's differ, and a strip
  // drawn against the wrong "now" would jump on hydration.
  const [now, setNow] = useState<number | null>(null);
  const [slice, setSlice] = useState<number | null>(null);
  const seen = useRef<Set<string> | null>(null);

  // The strip slides on its own: a 600px strip covers an hour, a pixel every six
  // seconds, so redrawing every five reads as continuous. With reduced motion it
  // redraws only when data arrives.
  useEffect(() => {
    setNow(Date.now());
    if (reduce) return;
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [reduce, dataVersion]);

  const windowMs = windowMinutes * 60_000;
  const start = (now ?? 0) - windowMs;
  const xPct = (t: number) => Math.min(100, Math.max(0, ((t - start) / windowMs) * 100));

  // Stack reports from the same minute, and mark the reader's own once.
  const drawn: { key: string; p: Point; x: number; y: number; you: boolean }[] = [];
  if (now !== null) {
    const stacks = new Map<string, number>();
    const dupes = new Map<string, number>();
    let youMarked = false;
    const all = [...points];
    const mineKey = mine ? pointKey(mine) : null;
    if (mine && !points.some((p) => pointKey(p) === mineKey)) all.push(mine);
    for (const p of all) {
      const t = new Date(p.t).getTime();
      if (t <= start) continue;
      const side = `${p.t}|${p.outcome}`;
      const k = stacks.get(side) ?? 0;
      stacks.set(side, k + 1);
      const base = pointKey(p);
      const n = dupes.get(base) ?? 0;
      dupes.set(base, n + 1);
      const you = !youMarked && mineKey !== null && base === mineKey;
      if (you) youMarked = true;
      const offset = 10 + Math.min(k, MAX_STACK) * STEP;
      drawn.push({ key: `${base}|${n}`, p, x: xPct(t), y: p.outcome === 'ok' ? MID - offset : MID + offset, you });
    }
  }

  // Dots that were not there on the first drawing drop in; the first drawing
  // just appears, because those reports did not arrive just now.
  const fresh = new Set<string>();
  if (now !== null) {
    if (seen.current === null) seen.current = new Set(drawn.map((d) => d.key));
    else for (const d of drawn) if (!seen.current.has(d.key)) fresh.add(d.key);
  }
  useEffect(() => {
    if (seen.current) for (const d of drawn) seen.current.add(d.key);
  });

  function sliceDetail(i: number): string {
    const from = start + (i * windowMs) / SLICES;
    const to = from + windowMs / SLICES;
    const inSlice = points.filter((p) => {
      const t = new Date(p.t).getTime();
      return t > from && t <= to;
    });
    const span = `${manilaTime(from)} to ${manilaTime(to)}`;
    if (!inSlice.length) return `${span}: no reports.`;
    const ok = inSlice.filter((p) => p.outcome === 'ok').length;
    const fail = inSlice.length - ok;
    const forms = [...new Set(inSlice.map((p) => p.form).filter(Boolean))];
    const counts = new Map<string, number>();
    for (const p of inSlice) if (p.failure) counts.set(p.failure, (counts.get(p.failure) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return [
      `${span}: ${fail} failed, ${ok} worked.`,
      forms.length ? `Forms: ${forms.join(', ')}.` : '',
      top ? `Mostly “${failureLabel(top[0])}”.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const d = e.key === 'ArrowRight' ? 1 : -1;
      setSlice((s) => (s === null ? (d > 0 ? 0 : SLICES - 1) : Math.min(SLICES - 1, Math.max(0, s + d))));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setSlice(e.key === 'Home' ? 0 : SLICES - 1);
    } else if (e.key === 'Escape') {
      setSlice(null);
    }
  }

  const bandStart =
    advisory?.startsAt && now !== null ? xPct(new Date(advisory.startsAt).getTime()) : null;
  const detailId = `timeline-detail-${systemKey}`;
  const empty = now !== null && drawn.length === 0;

  return (
    <div className="timeline">
      <div
        role="group"
        tabIndex={0}
        aria-label={`${label}, the last ${windowMinutes} minutes. ${summary}. Use the left and right arrow keys to step through five-minute slices.`}
        aria-describedby={detailId}
        onKeyDown={onKey}
        className="timeline-strip"
      >
        <svg width="100%" height={HEIGHT} aria-hidden="true" focusable="false" className="block overflow-visible">
          {bandStart !== null && (
            <rect x={`${bandStart}%`} y={0} width={`${100 - bandStart}%`} height={HEIGHT} className="timeline-band" />
          )}
          {Array.from({ length: SLICES }, (_, i) => (
            <rect
              key={i}
              x={`${(i * 100) / SLICES}%`}
              y={0}
              width={`${100 / SLICES}%`}
              height={HEIGHT}
              className={slice === i ? 'timeline-slice is-selected' : 'timeline-slice'}
              onClick={() => setSlice(slice === i ? null : i)}
            />
          ))}
          <line x1="0" x2="100%" y1={MID} y2={MID} className="timeline-axis" />
          {drawn.map((d) => (
            <g key={d.key} className={fresh.has(d.key) ? 'timeline-dot is-fresh' : 'timeline-dot'}>
              <circle
                cx={`${d.x}%`}
                cy={d.y}
                r={3.5}
                className={d.p.outcome === 'ok' ? 'dot-ok' : 'dot-fail'}
              />
              {d.you && (
                <>
                  <circle cx={`${d.x}%`} cy={d.y} r={7.5} className="dot-you" />
                  <text
                    x={`${d.x}%`}
                    y={d.p.outcome === 'ok' ? d.y - 12 : d.y + 20}
                    textAnchor={d.x > 92 ? 'end' : 'middle'}
                    className="dot-you-label"
                  >
                    you
                  </text>
                </>
              )}
            </g>
          ))}
          {empty && (
            <text x="50%" y={MID - 10} textAnchor="middle" className="timeline-empty">
              No reports in the last hour
            </text>
          )}
        </svg>
      </div>
      <div className="flex justify-between text-xs text-ink-muted mt-1" aria-hidden="true">
        <span>{windowMinutes} min ago</span>
        <span>worked above · failed below</span>
        <span>now</span>
      </div>
      <p id={detailId} aria-live="polite" className="text-sm mt-2 min-h-[2.75rem]">
        {slice === null ? (
          <span className="text-ink-muted">Tap a moment on the strip to see who reported what.</span>
        ) : (
          sliceDetail(slice)
        )}
      </p>
    </div>
  );
}
