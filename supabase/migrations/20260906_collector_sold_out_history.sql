alter table public.collector_run_history
  add column if not exists sold_out integer not null default 0 check (sold_out >= 0),
  add column if not exists recheck_at timestamptz;
