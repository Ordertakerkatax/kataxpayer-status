import 'server-only';
import { db } from './db';
import type { BoardAdvisory } from './board-types';
import { manilaDay } from './time';

export type MonthRow = {
  systemKey: string;
  /** "2026-09-01", the first of a Manila calendar month. */
  month: string;
  officialPct: number | null;
  communityPct: number | null;
  communityHours: number;
};

export type HistorySystem = { key: string; label: string };

/**
 * Monthly availability for the active systems, in the systems' own order.
 * v_monthly_availability covers every system in the table; an inactive one
 * (a retired system, or a test row) is left out here.
 */
export async function getHistory(): Promise<{ systems: HistorySystem[]; rows: MonthRow[] }> {
  const client = db();
  const [sysRes, rowsRes] = await Promise.all([
    client.from('systems').select('key, label').eq('active', true).order('sort').order('key'),
    client.from('v_monthly_availability').select('*').order('month'),
  ]);
  if (sysRes.error) throw new Error(`systems: ${sysRes.error.message}`);
  if (rowsRes.error) throw new Error(`v_monthly_availability: ${rowsRes.error.message}`);
  const systems = sysRes.data as HistorySystem[];
  const keys = new Set(systems.map((s) => s.key));
  const rows = (rowsRes.data as {
    system_key: string;
    month: string;
    official_pct: number | null;
    community_pct: number | null;
    community_hours: number;
  }[])
    .filter((r) => keys.has(r.system_key))
    .map((r) => ({
      systemKey: r.system_key,
      month: r.month,
      officialPct: r.official_pct === null ? null : Number(r.official_pct),
      communityPct: r.community_pct === null ? null : Number(r.community_pct),
      communityHours: r.community_hours,
    }));
  return { systems, rows };
}

/** Years from launch to now, newest first. Before launch there is nothing to show. */
export function yearsOf(rows: MonthRow[]): number[] {
  const now = Number(manilaDay().slice(0, 4));
  const first = rows.length ? Number(rows[0].month.slice(0, 4)) : now;
  const out: number[] = [];
  for (let y = now; y >= first; y--) out.push(y);
  return out;
}

const ADVISORY_COLUMNS = 'id, source_url, title, reference_no, issued_on, kind, systems, starts_at, ended_at';

/** Every confirmed advisory, newest first, as the public view gives them. */
export async function getAllAdvisories(): Promise<BoardAdvisory[]> {
  const { data, error } = await db().from('v_public_advisories').select(ADVISORY_COLUMNS);
  if (error) throw new Error(`v_public_advisories: ${error.message}`);
  return (data as {
    id: number;
    source_url: string;
    title: string;
    reference_no: string | null;
    issued_on: string | null;
    kind: string | null;
    systems: string[];
    starts_at: string | null;
    ended_at: string | null;
  }[]).map((a) => ({
    id: a.id,
    title: a.title,
    url: a.source_url,
    referenceNo: a.reference_no,
    issuedOn: a.issued_on,
    kind: a.kind,
    systems: a.systems,
    startsAt: a.starts_at,
    endedAt: a.ended_at,
  }));
}

/** The Manila date an advisory belongs to: when it starts, else when it was issued. */
export function advisoryDay(a: BoardAdvisory): string | null {
  if (a.startsAt) return manilaDay(a.startsAt);
  return a.issuedOn;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-09-01" → "September 2026". */
export const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** Two decimals, as stored, with a % sign; "No data" for a null. */
export const pct = (v: number | null) => (v === null ? 'No data' : `${v.toFixed(2)}%`);
