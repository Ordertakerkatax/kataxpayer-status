import { getHistory, monthLabel } from '@/lib/history';
import { csv, csvHeaders, row } from '@/lib/csv';

export const dynamic = 'force-dynamic';

/** The monthly table as CSV (spec §10), one row per system per month. ?year= narrows it. */
export async function GET(request: Request) {
  const year = new URL(request.url).searchParams.get('year');
  const { systems, rows } = await getHistory();
  const label = new Map(systems.map((s) => [s.key, s.label]));
  const order = new Map(systems.map((s, i) => [s.key, i]));
  const picked = (/^\d{4}$/.test(year ?? '') ? rows.filter((r) => r.month.startsWith(`${year}-`)) : rows)
    .slice()
    .sort((a, b) => a.month.localeCompare(b.month) || (order.get(a.systemKey) ?? 0) - (order.get(b.systemKey) ?? 0));
  const lines = [
    row(['month', 'month_name', 'system', 'official_availability_pct', 'community_availability_pct', 'community_hours_with_data']),
    ...picked.map((r) =>
      row([r.month.slice(0, 7), monthLabel(r.month), label.get(r.systemKey) ?? r.systemKey, r.officialPct, r.communityPct, r.communityHours]),
    ),
  ];
  return new Response(csv(lines), { headers: csvHeaders(`bir-filing-availability${/^\d{4}$/.test(year ?? '') ? `-${year}` : ''}.csv`) });
}
