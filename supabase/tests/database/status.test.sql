-- compute_status against the spec §5 list, plus the edges that matter.
-- Run with `supabase test db`. Everything happens in one rolled-back
-- transaction; each case uses its own system so they cannot leak into each other.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(28);

-- A fixed "now": 2 November 2026, noon in Manila.
create temp table t_at as select timestamptz '2026-11-02 12:00:00+08' as at;

insert into public.systems (key, label, sort, active)
select 'case_' || n, 'Case ' || n, 100 + n, false
from generate_series(1, 14) n;

-- ok_n successes and fail_n failures for one system, spread over the window
-- ending at `at`, each a minute apart, newest first.
create function pg_temp.add_reports(p_sys text, p_ok int, p_fail int)
returns void language sql as $$
  insert into public.reports (created_at, system_key, outcome, failure_type, device_hash, ip_hash)
  select (select at from t_at) - (i || ' minutes')::interval, p_sys,
         case when i < p_fail then 'fail' else 'ok' end,
         case when i < p_fail then 'submit_failed' end,
         'device-' || i, 'ip-' || i
  from generate_series(0, p_ok + p_fail - 1) i;
$$;

create function pg_temp.status(p_sys text, p_at timestamptz default null)
returns text language sql as $$
  select state from private.compute_status(p_sys, coalesce(p_at, (select at from t_at)));
$$;

-- An outage advisory, confirmed unless said otherwise.
create function pg_temp.add_outage(
  p_sys text, p_url text,
  p_status text default 'confirmed', p_audience text default 'external',
  p_ends timestamptz default null
) returns bigint language sql as $$
  insert into public.advisories (source_url, title, audience, kind, systems, starts_at, ends_at, review_status)
  values (p_url, 'Outage ' || p_url, p_audience, 'unavailable', array[p_sys],
          (select at from t_at) - interval '2 hours', p_ends, p_status)
  returning id;
$$;

-- The spec list ---------------------------------------------------------------

select is(pg_temp.status('case_1'), 'no_data', 'no reports: no_data');

select pg_temp.add_reports('case_2', 2, 0);
select is(pg_temp.status('case_2'), 'no_data', '2 reports: no_data');

select pg_temp.add_reports('case_3', 3, 0);
select is(pg_temp.status('case_3'), 'up', '3 ok: up');

select pg_temp.add_reports('case_4', 3, 5);
select is(pg_temp.status('case_4'), 'down', '5 fails out of 8: down');

select pg_temp.add_reports('case_5', 6, 3);
select is(pg_temp.status('case_5'), 'issues', '3 fails out of 9: issues');

select pg_temp.add_reports('case_6', 16, 4);
select is(pg_temp.status('case_6'), 'up', '4 fails out of 20: up');

-- The helper itself, so a miscount there cannot pass a case by accident.
select is(
  (select array_agg(array[ok_count, fail_count] order by s)
   from (values ('case_4'), ('case_5'), ('case_6')) v(s),
        lateral private.compute_status(s, (select at from t_at))),
  array[array[3, 5], array[6, 3], array[16, 4]],
  'the cases hold exactly the counts the spec names');

select pg_temp.add_outage('case_7', 'https://example.test/case7.pdf');
select is(pg_temp.status('case_7'), 'official_down',
  'open-ended confirmed outage, no restoration: official_down');
select is(
  (select advisory_id from private.compute_status('case_7', (select at from t_at))),
  (select id from public.advisories where source_url = 'https://example.test/case7.pdf'),
  'official_down names the advisory it rests on');

-- Same outage, then a confirmed restoration one hour before `at`.
select pg_temp.add_reports('case_8', 3, 0);
insert into public.advisories (source_url, title, audience, kind, systems, starts_at, review_status, related_advisory_id)
values ('https://example.test/case8-restored.pdf', 'Restored', 'unknown', 'restored', array['case_8'],
        (select at from t_at) - interval '1 hour', 'confirmed',
        pg_temp.add_outage('case_8', 'https://example.test/case8.pdf'));
select is(pg_temp.status('case_8'), 'up',
  'after a confirmed restoration: falls back to the community (3 ok = up)');
select is(pg_temp.status('case_8', (select at from t_at) - interval '90 minutes'), 'official_down',
  'but before the restoration time it was still official_down');

select pg_temp.add_outage('case_9', 'https://example.test/case9.pdf', p_status => 'pending');
select is(pg_temp.status('case_9'), 'no_data', 'a pending advisory is ignored');

select pg_temp.add_outage('case_10', 'https://example.test/case10.pdf', p_audience => 'internal');
select is(pg_temp.status('case_10'), 'no_data', 'an internal-audience advisory is ignored');

-- Edges ---------------------------------------------------------------------

-- A report exactly 60 minutes old is outside (at - 60, at].
insert into public.reports (created_at, system_key, outcome, device_hash, ip_hash)
select (select at from t_at) - interval '60 minutes', 'case_11', 'ok', 'd', 'i'
union all select (select at from t_at) - interval '59 minutes', 'case_11', 'ok', 'd', 'i'
union all select (select at from t_at) - interval '1 minute', 'case_11', 'ok', 'd', 'i';
select is(pg_temp.status('case_11'), 'no_data', 'a report exactly window_minutes old is not counted');
select is(
  (select ok_count from private.compute_status('case_11', (select at from t_at))), 2,
  'so the window holds two');

-- A report after `at` is not counted either.
select pg_temp.add_reports('case_12', 3, 0);
insert into public.reports (created_at, system_key, outcome, failure_type, device_hash, ip_hash)
select (select at from t_at) + interval '1 minute', 'case_12', 'fail', 'other', 'd', 'i'
from generate_series(1, 10);
select is(pg_temp.status('case_12'), 'up', 'reports after the moment asked about are ignored');

-- An outage with an ends_at in the past is over.
select pg_temp.add_outage('case_13', 'https://example.test/case13.pdf',
  p_ends => (select at from t_at) - interval '30 minutes');
select is(pg_temp.status('case_13'), 'no_data', 'an outage whose ends_at has passed is over');

-- The ratio and the minimum both have to hold for down: 5 fails of 10 is 0.5.
select pg_temp.add_reports('case_14', 5, 5);
select is(pg_temp.status('case_14'), 'issues', '5 fails out of 10 (ratio 0.5): issues, not down');

-- Settings are read, not hard-coded.
update public.settings set value = 2 where key = 'min_reports';
select is(pg_temp.status('case_2'), 'up', 'lowering min_reports to 2 turns 2 ok into up');
update public.settings set value = 3 where key = 'min_reports';

-- Snapshots follow the confirmed record ----------------------------------------

-- A snapshot of case_9 taken before its advisory is confirmed, then confirmed.
insert into public.status_snapshots (taken_at, system_key, state, ok_count, fail_count)
values ((select at from t_at) - interval '1 hour', 'case_9', 'no_data', 0, 0);
update public.advisories set review_status = 'confirmed', reviewed_at = (select at from t_at)
where source_url = 'https://example.test/case9.pdf';
select is(
  (select state from public.status_snapshots where system_key = 'case_9'),
  'official_down', 'confirming an outage rewrites the snapshots in its window');

update public.advisories set review_status = 'rejected'
where source_url = 'https://example.test/case9.pdf';
select is(
  (select state from public.status_snapshots where system_key = 'case_9'),
  'no_data', 'rejecting it again puts them back');

-- take_snapshot writes one row per active system for the 5-minute slot.
select private.take_snapshot(timestamptz '2026-11-02 12:03:20+08');
select private.take_snapshot(timestamptz '2026-11-02 12:04:59+08');
select is(
  (select count(*)::int from public.status_snapshots
   where taken_at = timestamptz '2026-11-02 12:00:00+08'),
  (select count(*)::int from public.systems where active),
  'take_snapshot: one row per active system, and a re-run of the slot overwrites');

-- Who can read what ---------------------------------------------------------

set local role anon;
select throws_ok('select * from public.reports', '42501', null, 'anon cannot read reports');
select throws_ok('select * from public.advisories', '42501', null, 'anon cannot read advisories');
select throws_ok('select * from public.settings', '42501', null, 'anon cannot read settings');
select throws_ok(
  $$insert into public.reports (system_key, outcome, device_hash, ip_hash) values ('efps','ok','x','x')$$,
  '42501', null, 'anon cannot insert reports');
select lives_ok('select * from public.v_live_status', 'anon can read v_live_status');
select lives_ok($$select * from public.v_recent_breakdown;
                  select * from public.v_public_advisories;
                  select * from public.v_monthly_availability$$,
  'anon can read the other three views');
reset role;

select * from finish();
rollback;
