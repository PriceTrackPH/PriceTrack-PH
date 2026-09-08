alter table public.collector_run_history drop constraint if exists collector_run_history_stop_status_check;
alter table public.collector_run_history add constraint collector_run_history_stop_status_check
  check (stop_status in ('stopped', 'stopped_safely', 'interrupted'));
