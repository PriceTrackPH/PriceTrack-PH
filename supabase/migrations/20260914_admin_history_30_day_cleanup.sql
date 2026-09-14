-- Keep private admin history for 30 days; cleanup runs daily from Vercel cron.
create or replace function public.delete_expired_admin_history()
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_deleted bigint := 0; v_count bigint;
begin
  delete from public.collector_run_history where stopped_at < now() - interval '30 days';
  get diagnostics v_count = row_count; v_deleted := v_deleted + v_count;
  delete from public.store_scan_history where started_at < now() - interval '30 days';
  get diagnostics v_count = row_count; v_deleted := v_deleted + v_count;
  delete from public.diagnostic_events where created_at < now() - interval '30 days';
  get diagnostics v_count = row_count; v_deleted := v_deleted + v_count;
  return v_deleted;
end;
$$;

create or replace function public.delete_expired_diagnostic_events()
returns bigint language plpgsql security definer set search_path = '' as $$
declare deleted_count bigint;
begin
  delete from public.diagnostic_events where created_at < now() - interval '30 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_expired_admin_history() from public, anon, authenticated;
grant execute on function public.delete_expired_admin_history() to service_role;
revoke all on function public.delete_expired_diagnostic_events() from public, anon, authenticated;
grant execute on function public.delete_expired_diagnostic_events() to service_role;
