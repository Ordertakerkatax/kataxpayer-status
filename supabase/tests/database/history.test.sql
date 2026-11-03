-- Spec §12 Phase 4 check: seeded snapshots and advisories for one month, and
-- both percentages from v_monthly_availability against a hand calculation.
-- The month is September 2026 in Manila: 30 days, 720 hours.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into public.systems (key, label, sort, active) values ('hist_1', 'History test', 900, false);

-- Official: outages first, because confirming one rewrites snapshots in its
-- window and would overwrite the hand-made ones below.
insert into public.advisories (source_url, title, audience, kind, systems, starts_at, ends_at, review_status) values
  -- 08:00 to 20:00 on the 10th, and an overlapping 18:00 to 22:00: merged, 14 hours, not 16.
  ('https://example.test/h1.pdf', 'h1', 'external', 'unavailable', '{hist_1}', '2026-09-10 08:00+08', '2026-09-10 20:00+08', 'confirmed'),
  ('https://example.test/h2.pdf', 'h2', 'external', 'unavailable', '{hist_1}', '2026-09-10 18:00+08', '2026-09-10 22:00+08', 'confirmed'),
  -- Across the month end, 22:00 on the 30th to 04:00 on 1 Oct: 2 hours in September.
  ('https://example.test/h3.pdf', 'h3', 'external', 'unavailable', '{hist_1}', '2026-09-30 22:00+08', '2026-10-01 04:00+08', 'confirmed'),
  -- Ignored: internal audience, and a pending one.
  ('https://example.test/h4.pdf', 'h4', 'internal', 'unavailable', '{hist_1}', '2026-09-05 08:00+08', '2026-09-05 13:00+08', 'confirmed'),
  ('https://example.test/h5.pdf', 'h5', 'external', 'unavailable', '{hist_1}', '2026-09-06 08:00+08', '2026-09-06 13:00+08', 'pending');
-- Open-ended from 09:00 on the 20th, closed by a confirmed restoration at 12:00: 3 hours.
with o as (
  insert into public.advisories (source_url, title, audience, kind, systems, starts_at, review_status)
  values ('https://example.test/h6.pdf', 'h6', 'external', 'unavailable', '{hist_1}', '2026-09-20 09:00+08', 'confirmed')
  returning id
)
insert into public.advisories (source_url, title, audience, kind, systems, starts_at, review_status, related_advisory_id)
select 'https://example.test/h6r.pdf', 'h6 restored', 'external', 'restored', '{hist_1}', '2026-09-20 12:00+08', 'confirmed', id from o;

-- Community: snapshots for nine hours, each slot five minutes apart. `states`
-- lists the slots of the hour in order.
create function pg_temp.hour(p_hour timestamptz, states text[]) returns void language sql as $$
  insert into public.status_snapshots (taken_at, system_key, state, ok_count, fail_count)
  select p_hour + (i - 1) * interval '5 minutes', 'hist_1', states[i], 0, 0
  from generate_subscripts(states, 1) i;
$$;
select pg_temp.hour('2026-09-02 09:00+08', array_fill('up'::text, array[12]));                       -- A up
select pg_temp.hour('2026-09-02 10:00+08', array_fill('up'::text, array[12]));                       -- B up
select pg_temp.hour('2026-09-03 09:00+08', array_fill('down'::text, array[6]) || array_fill('up'::text, array[6]));  -- C down: 6 of 12 is half
select pg_temp.hour('2026-09-03 10:00+08',
  array_fill('down'::text, array[4]) || array_fill('issues'::text, array[4]) || array_fill('up'::text, array[4]));    -- D issues: down 4, down+issues 8
select pg_temp.hour('2026-09-04 09:00+08', array_fill('no_data'::text, array[12]));                  -- E no data: not counted
select pg_temp.hour('2026-09-04 10:00+08', array_fill('official_down'::text, array[12]));            -- F official: not counted
select pg_temp.hour('2026-09-05 09:00+08', array_fill('down'::text, array[5]) || array_fill('up'::text, array[7]));  -- G up: 5 down is under half
select pg_temp.hour('2026-09-05 10:00+08',
  array_fill('official_down'::text, array[3]) || array_fill('down'::text, array[3]) || array_fill('no_data'::text, array[6])); -- H down: 3+3 reach half
select pg_temp.hour('2026-09-05 11:00+08', array['down', 'up']);                                      -- I down: a short hour, 1 of 2

create temp table t_sep as
  select * from public.v_monthly_availability where system_key = 'hist_1' and month = date '2026-09-01';

-- By hand. Official: down hours 14 + 2 + 3 = 19 of 720.
--   1 - 19/720 = 0.973611..., so 97.36.
select is((select official_pct from t_sep), 97.36, 'official: 19 outage hours of 720 is 97.36%');

-- Community: hours with data are A B C D G H I = 7 (E is no_data, F official_down).
--   Good (up or issues) are A B D G = 4. 4/7 = 0.571428..., so 57.14.
select is((select community_hours from t_sep), 7, 'community: 7 hours had enough reports');
select is((select community_pct from t_sep), 57.14, 'community: 4 good hours of 7 is 57.14%');

-- The pieces the totals rest on.
-- October holds the other 4 hours of h3 (00:00 to 04:00 on the 1st): 744 hours,
--   1 - 4/744 = 0.994623..., so 99.46.
select is(
  (select official_pct from public.v_monthly_availability where system_key = 'hist_1' and month = date '2026-10-01'),
  99.46, 'the cross-month outage: its 4 October hours count in October');
select is((select count(*)::int from public.v_monthly_availability where system_key = 'hist_1' and month = date '2026-09-01'),
  1, 'one row per system per month');

-- Readable with the public key, as the /history page reads it.
set local role anon;
select is((select official_pct from public.v_monthly_availability where system_key = 'hist_1' and month = date '2026-09-01'),
  97.36, 'anon reads the same figure through the view');
reset role;

-- Months start at the first snapshot (here September, the seeded "launch"),
-- so August, before any data, is not reported as 100% available.
select is((select min(month) from public.v_monthly_availability where system_key = 'hist_1'), date '2026-09-01',
  'months run from the first snapshot');

select * from finish();
rollback;
