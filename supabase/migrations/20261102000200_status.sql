-- Spec §5 and §10: the status logic, once, and the four views the public reads.
--
-- Everything that reads the base tables lives in the `private` schema, which
-- PostgREST does not expose, as security-definer functions. The public views are
-- `security_invoker` and only select from those functions, so a view can never
-- become a back door to a table, and the Supabase advisor has no
-- "security definer view" to flag.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- compute_status -----------------------------------------------------------

-- The state of one system at one moment. The live board and every snapshot
-- call this same function, so the two cannot disagree (spec §5).
--
-- An official outage ends at its ends_at, or, when that is null, at the time a
-- confirmed restoration linked to it says the system came back. A restoration
-- dated after `p_at` does not close it at `p_at`: history recomputed later
-- still shows the outage for the hours it lasted.
create or replace function private.compute_status(p_system_key text, p_at timestamptz)
returns table (state text, ok_count int, fail_count int, advisory_id bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window numeric;
  v_min numeric;
  v_down_fails numeric;
  v_down_ratio numeric;
  v_issue_fails numeric;
  v_issue_ratio numeric;
  v_ok int;
  v_fail int;
  v_ratio numeric;
  v_advisory bigint;
begin
  select
    max(value) filter (where key = 'window_minutes'),
    max(value) filter (where key = 'min_reports'),
    max(value) filter (where key = 'down_min_fails'),
    max(value) filter (where key = 'down_ratio'),
    max(value) filter (where key = 'issues_min_fails'),
    max(value) filter (where key = 'issues_ratio')
  into v_window, v_min, v_down_fails, v_down_ratio, v_issue_fails, v_issue_ratio
  from public.settings;

  select
    count(*) filter (where r.outcome = 'ok'),
    count(*) filter (where r.outcome = 'fail')
  into v_ok, v_fail
  from public.reports r
  where r.system_key = p_system_key
    and r.created_at > p_at - v_window * interval '1 minute'
    and r.created_at <= p_at;

  -- 1. The official override.
  select a.id
  into v_advisory
  from public.advisories a
  where a.review_status = 'confirmed'
    and a.kind = 'unavailable'
    and a.audience = 'external'
    and p_system_key = any (a.systems)
    and a.starts_at <= p_at
    and (
      a.ends_at > p_at
      or (
        a.ends_at is null
        and not exists (
          select 1
          from public.advisories r
          where r.related_advisory_id = a.id
            and r.review_status = 'confirmed'
            and r.kind = 'restored'
            and coalesce(r.starts_at, r.reviewed_at, r.created_at) <= p_at
        )
      )
    )
  order by a.starts_at desc, a.id desc
  limit 1;

  if v_advisory is not null then
    return query select 'official_down'::text, v_ok, v_fail, v_advisory;
    return;
  end if;

  -- 2 to 6. The community.
  if v_ok + v_fail < v_min then
    return query select 'no_data'::text, v_ok, v_fail, null::bigint;
    return;
  end if;

  v_ratio := v_fail::numeric / (v_ok + v_fail);

  return query select
    case
      when v_fail >= v_down_fails and v_ratio >= v_down_ratio then 'down'
      when v_fail >= v_issue_fails and v_ratio >= v_issue_ratio then 'issues'
      else 'up'
    end,
    v_ok, v_fail, null::bigint;
end;
$$;

revoke execute on function private.compute_status(text, timestamptz) from public, anon, authenticated;
grant execute on function private.compute_status(text, timestamptz) to service_role;

-- When an outage ends, if it has: its own ends_at, else the restoration that
-- closed it, else null (still open).
create or replace function private.outage_end(p_advisory_id bigint)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    a.ends_at,
    (
      select min(coalesce(r.starts_at, r.reviewed_at, r.created_at))
      from public.advisories r
      where r.related_advisory_id = a.id
        and r.review_status = 'confirmed'
        and r.kind = 'restored'
    )
  )
  from public.advisories a
  where a.id = p_advisory_id;
$$;
revoke execute on function private.outage_end(bigint) from public, anon, authenticated;

-- v_live_status --------------------------------------------------------------

-- One row per active system: the state now, the counts behind it, the time of
-- the latest report, the advisory when it is official, and the last state that
-- was not no_data, for the "Not enough reports" card.
create or replace function private.live_status()
returns table (
  system_key text,
  label text,
  sort int,
  state text,
  ok_count int,
  fail_count int,
  latest_report_at timestamptz,
  advisory_id bigint,
  advisory_title text,
  advisory_url text,
  last_known_state text,
  last_known_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.key,
    s.label,
    s.sort,
    c.state,
    c.ok_count,
    c.fail_count,
    (select max(r.created_at) from public.reports r where r.system_key = s.key),
    c.advisory_id,
    a.title,
    a.source_url,
    lk.state,
    lk.taken_at
  from public.systems s
  cross join lateral private.compute_status(s.key, now()) c
  left join public.advisories a on a.id = c.advisory_id
  left join lateral (
    select ss.state, ss.taken_at
    from public.status_snapshots ss
    where ss.system_key = s.key and ss.state <> 'no_data'
    order by ss.taken_at desc
    limit 1
  ) lk on true
  where s.active
  order by s.sort, s.key;
$$;

-- v_recent_breakdown -----------------------------------------------------------

-- Per system, for the current window: the three forms with the most failures
-- and the most common failure type, so the board can say "2550Q submissions
-- failing, mostly 'Submit fails or hangs'".
create or replace function private.recent_breakdown()
returns table (
  system_key text,
  top_forms jsonb,
  top_failure_type text,
  top_failure_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  with win as (
    select now() - value * interval '1 minute' as since
    from public.settings
    where key = 'window_minutes'
  ),
  fails as (
    select r.system_key, r.form_code, r.failure_type
    from public.reports r, win
    where r.outcome = 'fail' and r.created_at > win.since and r.created_at <= now()
  )
  select
    s.key,
    coalesce((
      select jsonb_agg(jsonb_build_object('form_code', f.form_code, 'fails', f.n)
                       order by f.n desc, f.form_code)
      from (
        select x.form_code, count(*)::int as n
        from fails x
        where x.system_key = s.key and x.form_code is not null
        group by x.form_code
        order by n desc, x.form_code
        limit 3
      ) f
    ), '[]'::jsonb),
    t.failure_type,
    t.n
  from public.systems s
  left join lateral (
    select x.failure_type, count(*)::int as n
    from fails x
    where x.system_key = s.key
    group by x.failure_type
    order by n desc, x.failure_type
    limit 1
  ) t on true
  where s.active
  order by s.sort, s.key;
$$;

-- v_public_advisories ----------------------------------------------------------

-- Confirmed advisories only, without the raw text and review fields. `ended_at`
-- is when an outage actually ended, from its own end or its restoration.
create or replace function private.public_advisories()
returns table (
  id bigint,
  source_url text,
  title text,
  reference_no text,
  issued_on date,
  audience text,
  kind text,
  systems text[],
  starts_at timestamptz,
  ended_at timestamptz,
  related_advisory_id bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id, a.source_url, a.title, a.reference_no, a.issued_on, a.audience, a.kind,
    a.systems, a.starts_at,
    case when a.kind = 'unavailable' then private.outage_end(a.id) else a.ends_at end,
    a.related_advisory_id
  from public.advisories a
  where a.review_status = 'confirmed'
  order by coalesce(a.starts_at, a.issued_on::timestamptz, a.created_at) desc, a.id desc;
$$;

-- v_monthly_availability -------------------------------------------------------

-- Two figures per system per Manila calendar month (spec §10), never blended.
--
-- official_pct: 1 - hours under confirmed external outage advisories / hours in
--   the month. Overlapping advisories are merged first so no hour counts twice.
--   The current month counts only the hours elapsed so far, or it would be
--   flattered by hours that have not happened yet.
-- community_pct: over the hours whose state was down, issues or up, the share
--   that were up or issues. community_hours is that count, shown beside it.
--
-- An hour takes the worst state that covered at least half of its snapshots:
-- walking from worst (official_down) to best (no_data), the first state at
-- which the snapshots seen so far reach half the hour. Months start at the
-- first snapshot, which is launch.
create or replace function private.monthly_availability()
returns table (
  system_key text,
  month date,
  official_pct numeric,
  community_pct numeric,
  community_hours int
)
language sql
stable
security definer
set search_path = ''
as $$
  with first_month as (
    select date_trunc('month', min(taken_at) at time zone 'Asia/Manila') as m
    from public.status_snapshots
  ),
  months as (
    select
      s.key as system_key,
      gs.m::date as month,
      gs.m at time zone 'Asia/Manila' as m_start,
      least((gs.m + interval '1 month') at time zone 'Asia/Manila', now()) as m_end
    from public.systems s
    cross join first_month fm
    cross join lateral generate_series(
      fm.m,
      date_trunc('month', now() at time zone 'Asia/Manila'),
      interval '1 month'
    ) as gs(m)
    where fm.m is not null
  ),
  outages as (
    select
      sys as system_key,
      tstzrange(
        a.starts_at,
        greatest(a.starts_at, coalesce(private.outage_end(a.id), now())),
        '[)'
      ) as span
    from public.advisories a
    cross join lateral unnest(a.systems) as sys
    where a.review_status = 'confirmed'
      and a.kind = 'unavailable'
      and a.audience = 'external'
      and a.starts_at is not null
  ),
  official as (
    select
      m.system_key,
      m.month,
      extract(epoch from m.m_end - m.m_start) / 3600 as month_hours,
      coalesce((
        select sum(extract(epoch from upper(piece) - lower(piece))) / 3600
        from unnest((
          select range_agg(o.span * tstzrange(m.m_start, m.m_end, '[)'))
          from outages o
          where o.system_key = m.system_key
            and o.span && tstzrange(m.m_start, m.m_end, '[)')
        )) as piece
      ), 0) as down_hours
    from months m
  ),
  per_state as (
    select
      ss.system_key,
      date_bin('1 hour', ss.taken_at, timestamptz '2000-01-01 00:00+08') as hr,
      ss.state,
      count(*) as n,
      case ss.state
        when 'official_down' then 1
        when 'down' then 2
        when 'issues' then 3
        when 'up' then 4
        else 5
      end as severity
    from public.status_snapshots ss
    group by 1, 2, 3
  ),
  running as (
    select
      p.*,
      sum(p.n) over (partition by p.system_key, p.hr order by p.severity
                     rows between unbounded preceding and current row) as seen,
      sum(p.n) over (partition by p.system_key, p.hr) as total
    from per_state p
  ),
  hour_state as (
    select distinct on (r.system_key, r.hr)
      r.system_key,
      date_trunc('month', r.hr at time zone 'Asia/Manila')::date as month,
      r.state
    from running r
    where r.seen * 2 >= r.total
    order by r.system_key, r.hr, r.severity
  ),
  community as (
    select
      h.system_key,
      h.month,
      count(*) filter (where h.state in ('up', 'issues')) as good,
      count(*) filter (where h.state in ('up', 'issues', 'down')) as with_data
    from hour_state h
    group by 1, 2
  )
  select
    o.system_key,
    o.month,
    case when o.month_hours > 0
      then round(100 * (1 - o.down_hours / o.month_hours), 2)
    end,
    case when coalesce(c.with_data, 0) > 0
      then round(100.0 * c.good / c.with_data, 2)
    end,
    coalesce(c.with_data, 0)::int
  from official o
  left join community c on c.system_key = o.system_key and c.month = o.month
  order by o.month, o.system_key;
$$;

-- The views ------------------------------------------------------------------

create or replace view public.v_live_status with (security_invoker = on) as
  select * from private.live_status();

create or replace view public.v_recent_breakdown with (security_invoker = on) as
  select * from private.recent_breakdown();

create or replace view public.v_public_advisories with (security_invoker = on) as
  select * from private.public_advisories();

create or replace view public.v_monthly_availability with (security_invoker = on) as
  select * from private.monthly_availability();

-- The public may read these four views and call nothing else.
revoke all on public.v_live_status, public.v_recent_breakdown,
  public.v_public_advisories, public.v_monthly_availability
  from anon, authenticated;
grant select on public.v_live_status, public.v_recent_breakdown,
  public.v_public_advisories, public.v_monthly_availability
  to anon, authenticated, service_role;

revoke execute on function private.live_status(), private.recent_breakdown(),
  private.public_advisories(), private.monthly_availability()
  from public;
grant execute on function private.live_status(), private.recent_breakdown(),
  private.public_advisories(), private.monthly_availability()
  to anon, authenticated, service_role;
