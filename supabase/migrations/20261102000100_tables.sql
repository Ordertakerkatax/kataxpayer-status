-- Spec §4: the tables, their seed data, and who may touch them.
--
-- The public reads nothing here directly. `anon` gets the four views in the
-- next migration and nothing else; reports go in through /api/report with the
-- service-role key. Grants are revoked as well as RLS being on, so a stray
-- anon query fails loudly with "permission denied" instead of quietly
-- returning no rows.

-- Systems we track. A table rather than a constant so eAFS or ORUS can be
-- added with an insert.
create table if not exists public.systems (
  key text primary key,
  label text not null,
  sort int not null default 0,
  active boolean not null default true
);

-- One row per community report.
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  system_key text not null references public.systems (key),
  outcome text not null check (outcome in ('ok', 'fail')),
  form_code text,
  failure_type text check (failure_type in (
    'site_unreachable', 'login_failed', 'form_wont_open', 'submit_failed',
    'no_confirmation', 'payment_failed', 'package_error', 'other'
  )),
  device_hash text not null,
  ip_hash text not null,
  -- A failure always says what failed; a success never does.
  check ((outcome = 'fail') = (failure_type is not null))
);
create index if not exists reports_system_time_idx on public.reports (system_key, created_at desc);
create index if not exists reports_device_idx on public.reports (device_hash, system_key, created_at desc);
create index if not exists reports_ip_idx on public.reports (ip_hash, created_at desc);

-- BIR advisories found by the watcher or entered by hand.
--
-- For kind = 'restored', starts_at is the moment the BIR says the system came
-- back ("DATE APPLICATION SYSTEMS ARE UP / AVAILABLE"). That is the time that
-- closes the outage named in related_advisory_id.
create table if not exists public.advisories (
  id bigint generated always as identity primary key,
  source_url text unique not null,
  title text not null,
  reference_no text,
  issued_on date,
  audience text check (audience in ('external', 'internal', 'unknown')),
  kind text check (kind in ('unavailable', 'restored', 'extension', 'other')),
  systems text[] not null default '{}',
  starts_at timestamptz,
  ends_at timestamptz,
  related_advisory_id bigint references public.advisories (id),
  raw_text text,
  parse_confidence text check (parse_confidence in ('high', 'low')),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'confirmed', 'rejected')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists advisories_related_idx on public.advisories (related_advisory_id);
create index if not exists advisories_reference_idx on public.advisories (reference_no);
-- The official override looks only at confirmed outages.
create index if not exists advisories_confirmed_outage_idx on public.advisories (starts_at)
  where review_status = 'confirmed' and kind = 'unavailable';

-- Computed status every 5 minutes; the basis of all history.
create table if not exists public.status_snapshots (
  taken_at timestamptz not null,
  system_key text not null references public.systems (key),
  state text not null check (state in ('official_down', 'down', 'issues', 'up', 'no_data')),
  ok_count int not null,
  fail_count int not null,
  primary key (taken_at, system_key)
);
create index if not exists status_snapshots_system_idx on public.status_snapshots (system_key, taken_at);

-- Tunable thresholds, read by compute_status.
create table if not exists public.settings (
  key text primary key,
  value numeric not null,
  note text
);

-- Who may use /admin. The app checks ADMIN_EMAIL before it shows anything; this
-- table is the same rule enforced in the database, so a signed-in stranger
-- holding a valid JWT still cannot read the advisory queue. Add the row by hand
-- (see README): the address is not in the repo.
create table if not exists public.admins (
  email text primary key check (email = lower(email))
);

-- Seed ---------------------------------------------------------------------

insert into public.systems (key, label, sort) values
  ('efps', 'eFPS', 10),
  ('ebirforms', 'eBIRForms', 20)
on conflict (key) do nothing;

insert into public.settings (key, value, note) values
  ('window_minutes', 60, 'reports older than this are ignored for the live status'),
  ('min_reports', 3, 'fewer than this in the window = no_data'),
  ('down_min_fails', 5, null),
  ('down_ratio', 0.6, 'fail share at or above this, with enough fails = down'),
  ('issues_min_fails', 3, null),
  ('issues_ratio', 0.3, null),
  ('cooldown_minutes', 15, 'one report per device per system in this period'),
  ('ip_max_per_window', 10, 'per IP hash per cooldown period (offices share an IP)')
on conflict (key) do nothing;

-- Access -------------------------------------------------------------------

alter table public.systems enable row level security;
alter table public.reports enable row level security;
alter table public.advisories enable row level security;
alter table public.status_snapshots enable row level security;
alter table public.settings enable row level security;
alter table public.admins enable row level security;

-- Supabase grants anon and authenticated everything on new public tables by
-- default. Take it back: RLS alone would answer anon with an empty list.
revoke all on public.systems, public.reports, public.advisories,
  public.status_snapshots, public.settings, public.admins
  from anon, authenticated;

-- True when the signed-in user's e-mail is in public.admins. Security definer
-- because authenticated cannot read that table itself.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins
    where email = lower((select auth.jwt() ->> 'email'))
  );
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- The admin reads and edits advisories and settings (spec §9), and nothing
-- else, through their own session.
grant select, insert, update on public.advisories to authenticated;
grant select, update on public.settings to authenticated;

drop policy if exists advisories_admin on public.advisories;
create policy advisories_admin on public.advisories
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
