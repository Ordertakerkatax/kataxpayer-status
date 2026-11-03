import 'server-only';
import { db } from './db';
import { FAILURE_TYPES } from './catalogue';
import type { Board, BoardAdvisory, Point, SystemStatus } from './board-types';
import type { State } from './states';

/** Spec §7 cap on points drawn per system (docs/board-motion.md). The counts never use it. */
const MAX_POINTS = 300;

const ADVISORY_COLUMNS =
  'id, source_url, title, reference_no, issued_on, kind, systems, starts_at, ended_at';

type AdvisoryRow = {
  id: number;
  source_url: string;
  title: string;
  reference_no: string | null;
  issued_on: string | null;
  kind: string | null;
  systems: string[];
  starts_at: string | null;
  ended_at: string | null;
};

const toAdvisory = (a: AdvisoryRow): BoardAdvisory => ({
  id: a.id,
  title: a.title,
  url: a.source_url,
  referenceNo: a.reference_no,
  issuedOn: a.issued_on,
  kind: a.kind,
  systems: a.systems,
  startsAt: a.starts_at,
  endedAt: a.ended_at,
});

const failureLabel = (key: string) => FAILURE_TYPES.find((f) => f.key === key)?.label ?? key;

function floorToMinute(iso: string): string {
  const ms = new Date(iso).getTime();
  return new Date(ms - (ms % 60_000)).toISOString();
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

/**
 * Reports in the live window as bare points. Read with the service role from
 * `reports`, which anon cannot see, and stripped here to time, outcome, form and
 * failure type, the time rounded down to the minute. No hash or ID leaves.
 */
async function points(systemKey: string, since: string): Promise<Point[]> {
  const rows = must(
    await db()
      .from('reports')
      .select('created_at, outcome, form_code, failure_type')
      .eq('system_key', systemKey)
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_POINTS),
    `points for ${systemKey}`,
  ) as { created_at: string; outcome: 'ok' | 'fail'; form_code: string | null; failure_type: string | null }[];
  return rows
    .map((r) => ({ t: floorToMinute(r.created_at), outcome: r.outcome, form: r.form_code, failure: r.failure_type }))
    .reverse();
}

/**
 * The board as it stands now, for every active system, or only `only`. One
 * function feeds the home page's first render, the 30-second poll and the reply
 * to a report, so the three cannot describe the same moment differently.
 */
export async function getBoard(only?: string): Promise<Board> {
  const client = db();
  const now = new Date();

  const [liveRes, breakdownRes, windowRes, latestRes] = await Promise.all([
    only
      ? client.from('v_live_status').select('*').eq('system_key', only)
      : client.from('v_live_status').select('*'),
    client.from('v_recent_breakdown').select('*'),
    client.from('settings').select('value').eq('key', 'window_minutes').single(),
    client
      .from('v_public_advisories')
      .select(ADVISORY_COLUMNS)
      .order('issued_on', { ascending: false, nullsFirst: false })
      .order('starts_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(5),
  ]);

  const live = must(liveRes, 'v_live_status') as {
    system_key: string;
    label: string;
    sort: number;
    state: State;
    ok_count: number;
    fail_count: number;
    latest_report_at: string | null;
    advisory_id: number | null;
    last_known_state: State | null;
    last_known_at: string | null;
  }[];
  const breakdown = must(breakdownRes, 'v_recent_breakdown') as {
    system_key: string;
    top_forms: { form_code: string; fails: number }[] | null;
    top_failure_type: string | null;
    top_failure_count: number | null;
  }[];
  const windowMinutes = Number(must(windowRes, 'settings').value);
  const latest = (must(latestRes, 'v_public_advisories') as AdvisoryRow[]).map(toAdvisory);

  // An official_down names its advisory; fetch any the latest five do not hold.
  const wanted = [...new Set(live.map((l) => l.advisory_id).filter((id): id is number => id !== null))];
  const missing = wanted.filter((id) => !latest.some((a) => a.id === id));
  const extra = missing.length
    ? (must(
        await client.from('v_public_advisories').select(ADVISORY_COLUMNS).in('id', missing),
        'advisories by id',
      ) as AdvisoryRow[]).map(toAdvisory)
    : [];
  const byId = new Map([...latest, ...extra].map((a) => [a.id, a]));

  const since = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
  const allPoints = await Promise.all(live.map((l) => points(l.system_key, since)));

  const systems: SystemStatus[] = live
    .sort((a, b) => a.sort - b.sort || a.system_key.localeCompare(b.system_key))
    .map((l) => {
      const b = breakdown.find((x) => x.system_key === l.system_key);
      return {
        key: l.system_key,
        label: l.label,
        state: l.state,
        ok: l.ok_count,
        fail: l.fail_count,
        latestReportAt: l.latest_report_at,
        advisory: l.advisory_id !== null ? (byId.get(l.advisory_id) ?? null) : null,
        lastKnown: l.last_known_state && l.last_known_at ? { state: l.last_known_state, at: l.last_known_at } : null,
        topForms: (b?.top_forms ?? []).map((f) => ({ form: f.form_code, fails: f.fails })),
        topFailure:
          b?.top_failure_type && b.top_failure_count
            ? { key: b.top_failure_type, label: failureLabel(b.top_failure_type), count: b.top_failure_count }
            : null,
        points: allPoints[live.indexOf(l)],
      };
    });

  return { generatedAt: now.toISOString(), windowMinutes, systems, advisories: latest };
}
