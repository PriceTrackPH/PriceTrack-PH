create table if not exists public.collector_run_history (
  run_id uuid primary key,
  started_at timestamptz not null,
  stopped_at timestamptz not null,
  duration_seconds integer not null check (duration_seconds >= 0),
  succeeded integer not null check (succeeded >= 0),
  failed integer not null check (failed >= 0),
  remaining integer not null check (remaining >= 0),
  stop_status text not null check (stop_status in ('stopped', 'stopped_safely')),
  created_at timestamptz not null default now()
);

alter table public.collector_run_history enable row level security;
revoke all on table public.collector_run_history from anon, authenticated;
grant select, insert on table public.collector_run_history to service_role;

create index if not exists collector_run_history_stopped_at_idx
  on public.collector_run_history (stopped_at desc);
