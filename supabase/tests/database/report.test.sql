-- submit_report: the cooldown and the network limit from spec §6, and that only
-- the server can call it. Rolled back like the status tests.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

select is(public.submit_report('efps', 'ok', null, null, 'dev-a', 'ip-a'), 'ok', 'a first report goes in');
select is(public.submit_report('efps', 'fail', 'other', null, 'dev-a', 'ip-a'), 'device_cooldown',
  'the same device on the same system within cooldown_minutes is refused');
select is(public.submit_report('ebirforms', 'ok', null, '2550Q', 'dev-a', 'ip-a'), 'ok',
  'the same device may still report the other system');

-- An old report does not hold the device back.
update public.reports set created_at = now() - interval '16 minutes' where device_hash = 'dev-a';
select is(public.submit_report('efps', 'ok', null, null, 'dev-a', 'ip-a'), 'ok',
  'after cooldown_minutes the device may report again');

-- One office network: ten devices go in, the eleventh is refused. Counted inside
-- the assertion, because ten bare rows reading "ok" are TAP lines to pg_prove.
select is(
  (select count(*)::int
   from (select public.submit_report('efps', 'ok', null, null, 'office-' || i, 'ip-office') r
         from generate_series(1, 10) i) s
   where r = 'ok'),
  10, 'ten devices on one network all go in');
select is(public.submit_report('efps', 'ok', null, null, 'office-11', 'ip-office'), 'ip_limit',
  'the eleventh within the period is refused');

select throws_ok($$select public.submit_report('efps', 'fail', null, null, 'dev-z', 'ip-z')$$, '23514',
  null, 'a failure with no failure type is still refused by the table');

-- Asked of the catalogue rather than by calling it as anon: a throws_ok that
-- catches a function permission error as anon segfaults this Postgres 17.6
-- build (seen 3 November 2026). The anon-check script also calls it over HTTP.
select ok(
  not has_function_privilege('anon', 'public.submit_report(text,text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.submit_report(text,text,text,text,text,text)', 'execute'),
  'neither anon nor a signed-in user can call submit_report');

select * from finish();
rollback;
