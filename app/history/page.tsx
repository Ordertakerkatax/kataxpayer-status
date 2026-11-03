import type { Metadata } from 'next';
import Link from 'next/link';
import { AvailabilityChart } from '@/components/availability-chart';
import { getHistory, monthLabel, pct, yearsOf } from '@/lib/history';
import { manilaDay } from '@/lib/time';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Availability history',
  description: 'Month by month, how often eFPS and eBIRForms were available: from BIR advisories and from filers’ reports.',
  alternates: { canonical: '/history' },
};

/** /history (spec §10): two figures per system per month, never blended. */
export default async function History({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: yearParam } = await searchParams;
  const { systems, rows } = await getHistory();
  const years = yearsOf(rows);
  const year = years.includes(Number(yearParam)) ? Number(yearParam) : years[0];
  const thisMonth = `${manilaDay().slice(0, 7)}-01`;

  const inYear = rows.filter((r) => r.month.startsWith(`${year}-`));
  const months = [...new Set(inYear.map((r) => r.month))].sort();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl sm:text-4xl">Availability by month</h1>
        <p className="max-w-2xl">
          Two numbers for each system, because they measure different things. <strong>Official</strong> counts the hours
          the BIR itself said a system was down. <strong>Community</strong> counts what filers reported. They are never
          added together. <a href="#how-we-count">How we count</a>
        </p>
      </div>

      {years.length > 1 && (
        <nav aria-label="Year" className="flex flex-wrap gap-2">
          {years.map((y) => (
            <Link key={y} href={`/history?year=${y}`} aria-current={y === year ? 'page' : undefined} className="chip">
              {y}
            </Link>
          ))}
        </nav>
      )}

      {months.length === 0 ? (
        <p className="text-ink-muted">
          The record starts when the board does. The first month appears here once its first five-minute snapshot is
          taken.
        </p>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <AvailabilityChart title={`Official availability, ${year}`} measure="officialPct" systems={systems} months={months} rows={inYear} />
            <AvailabilityChart title={`Community-reported availability, ${year}`} measure="communityPct" systems={systems} months={months} rows={inYear} />
          </div>

          <section aria-labelledby="table-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="table-heading" className="text-2xl">
                {year}, month by month
              </h2>
              <a href={`/history/export?year=${year}`} download>
                Download CSV
              </a>
            </div>
            <div className="table-scroll" role="region" aria-labelledby="table-heading" tabIndex={0}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    {systems.map((s) => (
                      <th key={s.key} scope="col">
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m}>
                      <th scope="row">
                        {monthLabel(m)}
                        {m === thisMonth && <span className="block text-xs font-normal text-ink-muted">so far</span>}
                        <Link
                          href={`/advisories?year=${m.slice(0, 4)}&month=${Number(m.slice(5, 7))}`}
                          className="block text-sm font-normal mt-1"
                        >
                          Advisories<span className="sr-only"> for {monthLabel(m)}</span>
                        </Link>
                      </th>
                      {systems.map((s) => {
                        const r = inYear.find((x) => x.systemKey === s.key && x.month === m);
                        return (
                          <td key={s.key}>
                            <span className="block">
                              <span className="text-ink-muted text-sm">Official </span>
                              {pct(r?.officialPct ?? null)}
                            </span>
                            <span className="block">
                              <span className="text-ink-muted text-sm">Community </span>
                              {pct(r?.communityPct ?? null)}
                              {r && r.communityHours > 0 && (
                                <span className="text-ink-muted text-sm">
                                  {' '}
                                  over {r.communityHours} {r.communityHours === 1 ? 'hour' : 'hours'}
                                </span>
                              )}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section aria-labelledby="how-we-count" id="how-we-count" className="flex flex-col gap-3 max-w-2xl">
        <h2 id="how-we-count-heading" className="text-2xl">
          How we count
        </h2>
        <p>
          <strong>Official availability</strong> is the share of the month&apos;s hours that no confirmed BIR advisory
          said the system was down. We only count advisories addressed to the public, and only after checking them
          against the BIR&apos;s own PDF. An outage runs until its stated end, or until the BIR says the system is back.
          Two advisories covering the same hours count those hours once. For the month we are in, only the hours so far
          are counted.
        </p>
        <p>
          <strong>Community-reported availability</strong> looks only at the hours when enough filers reported to tell.
          Each hour takes the worst state that covered at least half of it: if half the hour looked down, the hour counts
          as down. The figure is the share of those hours when the system was working or only having problems. The
          number of hours beside it shows how much the figure rests on: a month with a handful of hours says little.
        </p>
        <p>
          Hours under an official BIR outage are left out of the community figure, so the two do not count the same
          outage twice. Neither figure is a BIR statistic.
        </p>
      </section>
    </div>
  );
}
