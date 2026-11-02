-- Spec §10: a snapshot every 5 minutes, and history that follows the confirmed
-- record when an advisory is confirmed or edited after the fact.

create extension if not exists pg_cron with schema pg_catalog;

-- One row per active system for the 5-minute slot containing p_at. Re-running a
-- slot overwrites it, so a retried cron run cannot create a duplicate.
create or replace function private.take_snapshot(p_at timestamptz default now())
returns void
language sql
security definer
set search_path = ''
as $$
  with slot as (
    select date_bin('5 minutes', p_at, timestamptz '2000-01-01 00:00+00') as t
  )
  insert into public.status_snapshots (taken_at, system_key, state, ok_count, fail_count)
  select slot.t, s.key, c.state, c.ok_count, c.fail_count
  from public.systems s
  cross join slot
  cross join lateral private.compute_status(s.key, slot.t) c
  where s.active
  on conflict (taken_at, system_key) do update
    set state = excluded.state,
        ok_count = excluded.ok_count,
        fail_count = excluded.fail_count;
$$;

-- Rewrites every snapshot taken in [p_from, p_to] from compute_status as it
-- stands now. Returns how many rows it touched.
create or replace function private.recompute_snapshots(p_from timestamptz, p_to timestamptz)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.status_snapshots ss
  set (state, ok_count, fail_count) = (
    select c.state, c.ok_count, c.fail_count
    from private.compute_status(ss.system_key, ss.taken_at) c
  )
  where ss.taken_at >= p_from and ss.taken_at <= p_to;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function private.take_snapshot(timestamptz),
  private.recompute_snapshots(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.take_snapshot(timestamptz),
  private.recompute_snapshots(timestamptz, timestamptz)
  to service_role;

-- When an outage or a restoration is confirmed, un-confirmed or edited, redo the
-- snapshots it could have touched: from the outage's start to now. Over-reaching
-- is harmless; recompute is idempotent. An advisory that was never confirmed,
-- before or after the change, cannot have touched history and is skipped.
create or replace function private.advisory_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows public.advisories[] := '{}';
  v_row public.advisories;
  v_was_confirmed boolean := false;
  v_is_confirmed boolean := false;
  v_from timestamptz;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_rows := v_rows || old;
    v_was_confirmed := old.review_status = 'confirmed';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_rows := v_rows || new;
    v_is_confirmed := new.review_status = 'confirmed';
  end if;

  if not (v_was_confirmed or v_is_confirmed) then
    return null;
  end if;

  foreach v_row in array v_rows loop
    v_from := null;
    if v_row.kind = 'unavailable' then
      v_from := v_row.starts_at;
    elsif v_row.kind = 'restored' then
      select a.starts_at into v_from
      from public.advisories a
      where a.id = v_row.related_advisory_id;
    end if;

    if v_from is not null and v_from <= now() then
      perform private.recompute_snapshots(v_from, now());
    end if;
  end loop;
  return null;
end;
$$;
revoke execute on function private.advisory_changed() from public, anon, authenticated;

drop trigger if exists advisories_recompute on public.advisories;
create trigger advisories_recompute
  after insert or update or delete on public.advisories
  for each row execute function private.advisory_changed();

-- Every 5 minutes. cron.schedule replaces a job of the same name, so re-running
-- this migration leaves exactly one.
select cron.schedule('status-snapshot', '*/5 * * * *', $$select private.take_snapshot()$$);
