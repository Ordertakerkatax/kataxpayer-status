import type { Metadata } from 'next';
import { SYSTEMS } from '@/lib/catalogue';
import { MONTH_NAMES, advisoryDay, getAllAdvisories } from '@/lib/history';
import { manilaDate, manilaDay, manilaTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'BIR advisories',
  description: 'Every BIR advisory on eFPS and eBIRForms availability that the board has confirmed, with links to the BIR’s PDFs.',
  alternates: { canonical: '/advisories' },
};

const KIND_LABEL: Record<string, string> = {
  unavailable: 'Outage',
  restored: 'Back up',
  extension: 'Deadline extension',
  other: 'Other',
};

const systemLabel = (key: string) => SYSTEMS.find((s) => s.key === key)?.label ?? key;

function when(iso: string) {
  return `${manilaDate(iso)}, ${manilaTime(iso)}`;
}

type Search = { system?: string; year?: string; month?: string };

/** /advisories (spec §11): every confirmed advisory, filterable by system and year. */
export default async function Advisories({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const all = await getAllAdvisories();

  const system = SYSTEMS.some((s) => s.key === params.system) ? params.system! : '';
  const nowYear = Number(manilaDay().slice(0, 4));
  const firstYear = Math.min(nowYear, ...all.map((a) => Number(advisoryDay(a)?.slice(0, 4) ?? nowYear)));
  const years = Array.from({ length: nowYear - firstYear + 1 }, (_, i) => nowYear - i);
  const year = years.includes(Number(params.year)) ? Number(params.year) : null;
  const month = year && Number(params.month) >= 1 && Number(params.month) <= 12 ? Number(params.month) : null;

  const shown = all.filter((a) => {
    if (system && !a.systems.includes(system)) return false;
    const day = advisoryDay(a);
    if (year && !day?.startsWith(`${year}-`)) return false;
    if (month && Number(day?.slice(5, 7)) !== month) return false;
    return true;
  });

  const scope = [
    system ? systemLabel(system) : null,
    month && year ? `${MONTH_NAMES[month - 1]} ${year}` : year ? String(year) : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl sm:text-4xl">BIR advisories</h1>
        <p className="max-w-2xl">
          Every BIR advisory about eFPS or eBIRForms that the board counts, each checked against the BIR&apos;s own PDF
          before it appears here. The PDF is the record; this list only points to it.
        </p>
      </div>

      {/* A plain GET form: it works with JavaScript off, and the URL is shareable. */}
      <form method="get" className="filter-row" aria-label="Filter advisories">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">System</span>
          <select name="system" defaultValue={system} className="field">
            <option value="">Both</option>
            {SYSTEMS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Year</span>
          <select name="year" defaultValue={year ?? ''} className="field">
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        {month && <input type="hidden" name="month" value={month} />}
        <button type="submit" className="btn-quiet self-end min-h-12">
          Show
        </button>
      </form>

      <p role="status" className="text-sm text-ink-muted">
        {shown.length} {shown.length === 1 ? 'advisory' : 'advisories'}
        {scope && <> for {scope}</>}
        {month && (
          <>
            {' '}
            · <a href={`/advisories?${new URLSearchParams({ ...(system && { system }), ...(year && { year: String(year) }) })}`}>whole year</a>
          </>
        )}
      </p>

      {shown.length === 0 ? (
        <p className="text-ink-muted">
          {all.length === 0
            ? 'No advisories confirmed yet. They appear here once checked against the BIR’s PDF.'
            : 'None match. Try both systems or all years.'}
        </p>
      ) : (
        <ul className="advisory-list">
          {shown.map((a) => (
            <li key={a.id}>
              <p className="text-sm text-ink-muted">
                <span className="font-semibold text-ink">{KIND_LABEL[a.kind ?? ''] ?? 'Advisory'}</span>
                {a.systems.length > 0 && <> · {a.systems.map(systemLabel).join(', ')}</>}
                {a.referenceNo && <> · {a.referenceNo}</>}
              </p>
              <p className="font-semibold">
                <a href={a.url} target="_blank" rel="noopener">
                  {a.title}
                </a>{' '}
                <span className="text-sm font-normal text-ink-muted">(PDF)</span>
              </p>
              <p className="text-sm">
                {a.kind === 'restored' && a.startsAt ? (
                  <>Back up from {when(a.startsAt)}</>
                ) : a.startsAt ? (
                  <>
                    From {when(a.startsAt)}
                    {a.endedAt ? <> to {when(a.endedAt)}</> : a.kind === 'unavailable' ? <>, not yet restored</> : null}
                  </>
                ) : a.issuedOn ? (
                  <>Issued {manilaDate(`${a.issuedOn}T00:00:00+08:00`)}</>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
