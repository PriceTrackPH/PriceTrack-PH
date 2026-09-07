alter table public.collector_run_history
  add column if not exists same_price integer not null default 0 check (same_price >= 0),
  add column if not exists same_price_recheck_at timestamptz;

create or replace function public.collector_available_summary_v2()
returns table (
  total_tracked bigint,
  total_due bigint,
  sold_out_deferred bigint,
  same_price_deferred bigint
)
language sql
security definer
set search_path = public
as $$
  select
    count(*) filter (
      where p.platform = 'shopee' and p.is_active and p.tracking_enabled
    ) as total_tracked,
    count(*) filter (
      where p.platform = 'shopee'
        and p.is_active
        and p.tracking_enabled
        and coalesce(p.next_check_at, now()) <= now()
        and exists (
          select 1 from public.product_variations v
          where v.product_id = p.id and v.is_active
        )
    ) as total_due,
    count(*) filter (
      where p.platform = 'shopee'
        and p.is_active
        and p.tracking_enabled
        and not exists (
          select 1 from public.product_variations v
          where v.product_id = p.id and v.is_active
        )
    ) as sold_out_deferred,
    count(*) filter (
      where p.platform = 'shopee'
        and p.is_active
        and p.tracking_enabled
        and coalesce(p.all_variations_sold_out, false) = false
        and p.next_check_at > now()
        and exists (
          select 1 from public.product_variations v
          where v.product_id = p.id and v.is_active
        )
        and exists (
          select 1
          from public.product_daily_checks c
          where c.product_id = p.id
            and c.status = 'success'
            and c.checked_at = p.last_checked_at
            and coalesce((c.metadata ->> 'skip_unchanged_day')::boolean, false)
            and coalesce((c.metadata ->> 'all_variations_unchanged')::boolean, false)
        )
    ) as same_price_deferred
  from public.products p;
$$;

revoke all on function public.collector_available_summary_v2() from public, anon, authenticated;
grant execute on function public.collector_available_summary_v2() to service_role;
