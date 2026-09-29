create table public.priority_push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  last_notified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.priority_push_subscriptions enable row level security;
revoke all on public.priority_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.priority_push_subscriptions to service_role;

create index priority_push_subscriptions_last_notified_idx
  on public.priority_push_subscriptions (last_notified_at);
