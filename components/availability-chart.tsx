import type { HistorySystem, MonthRow } from '@/lib/history';
import { MONTH_NAMES, monthLabel, pct } from '@/lib/history';

/**
 * One measure, month by month, a bar per system (spec §10, "a simple bar
 * chart"). Plain HTML, no chart library. Bars start at zero, because a bar
 * that starts at 90% turns a two-point dip into a collapse. Both figures are
 * on the same 0 to 100 scale but are drawn as two charts, never blended.
 *
 * Series colours are validated (dataviz check, 3 Nov 2026): #0a7d55 and
 * #d9a20d pass lightness, chroma and colour-blind separation on white. The gold
 * is under 3:1 against the page, so the legend, the hover titles and the table
 * below always carry the numbers too.
 */
type Props = {
  title: string;
  measure: 'officialPct' | 'communityPct';
  systems: HistorySystem[];
  months: string[];
  rows: MonthRow[];
};

export function AvailabilityChart({ title, measure, systems, months, rows }: Props) {
  const value = (system: string, month: string) => {
    const r = rows.find((x) => x.systemKey === system && x.month === month);
    return r ? r[measure] : null;
  };

  return (
    <figure className="avail-chart">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold">{title}</span>
        <span className="avail-legend">
          {systems.map((s, i) => (
            <span key={s.key} className="avail-legend-item">
              <span className={`avail-swatch series-${i}`} aria-hidden="true" />
              {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      {/* The table below is the accessible version; this is a picture of it. */}
      <div className="avail-plot" aria-hidden="true">
        <div className="avail-grid">
          <span style={{ bottom: '100%' }}>100%</span>
          <span style={{ bottom: '50%' }}>50%</span>
          <span style={{ bottom: '0%' }}>0%</span>
        </div>
        <div className="avail-bars">
          {months.map((m) => (
            <div key={m} className="avail-month">
              <div className="avail-pair">
                {systems.map((s, i) => {
                  const v = value(s.key, m);
                  return v === null ? (
                    <div key={s.key} className="avail-bar is-empty" title={`${s.label}, ${monthLabel(m)}: no data`} />
                  ) : (
                    <div
                      key={s.key}
                      className={`avail-bar series-${i}`}
                      style={{ height: `${Math.max(v, 0.5)}%` }}
                      title={`${s.label}, ${monthLabel(m)}: ${pct(v)}`}
                    />
                  );
                })}
              </div>
              <span className="avail-month-label">{MONTH_NAMES[Number(m.slice(5, 7)) - 1].slice(0, 3)}</span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
