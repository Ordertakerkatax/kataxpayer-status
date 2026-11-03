-- Spec §6 steps 5 and 6: the rate limit and the insert, in one transaction.
--
-- Checked in the route instead, two taps in the same instant would both read
-- "no recent report" and both go in. Here the device and the network are each
-- locked before counting, so the second waits and then sees the first.

create or replace function public.submit_report(
  p_system_key text,
  p_outcome text,
  p_failure_type text,
  p_form_code text,
  p_device_hash text,
  p_ip_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cooldown numeric;
  v_ip_max numeric;
  v_since timestamptz;
begin
  select value into v_cooldown from public.settings where key = 'cooldown_minutes';
  select value into v_ip_max from public.settings where key = 'ip_max_per_window';
  v_since := now() - v_cooldown * interval '1 minute';

  -- Always the network first, then the device, so two calls can never each hold
  -- the lock the other is waiting for.
  perform pg_advisory_xact_lock(hashtextextended('report-ip:' || p_ip_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('report-device:' || p_device_hash, 0));

  if exists (
    select 1 from public.reports
    where device_hash = p_device_hash
      and system_key = p_system_key
      and created_at > v_since
  ) then
    return 'device_cooldown';
  end if;

  -- "More than ip_max_per_window": the tenth goes in, the eleventh does not.
  if (
    select count(*) from public.reports
    where ip_hash = p_ip_hash and created_at > v_since
  ) >= v_ip_max then
    return 'ip_limit';
  end if;

  insert into public.reports (system_key, outcome, failure_type, form_code, device_hash, ip_hash)
  values (p_system_key, p_outcome, p_failure_type, p_form_code, p_device_hash, p_ip_hash);
  return 'ok';
end;
$$;

-- Supabase grants execute on new public functions to anon by default. Callable
-- with the public key, this would be a way to post reports past Turnstile.
revoke execute on function public.submit_report(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_report(text, text, text, text, text, text)
  to service_role;
