-- Total Same Price is a Manila-day count of successfully recorded unchanged products.
-- Their next_check_at remains the normal scheduling source (tomorrow skipped when enabled).
create or replace function public.collector_available_summary_v2()
returns table (
  total_tracked bigint,
  total_due bigint,
  sold_out_deferred bigint,
  same_price_deferred bigint
)
language sql
security definer
set search_path = ''
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
    (
      select count(*)
      from public.product_daily_checks c
      join public.products checked_product on checked_product.id = c.product_id
      where c.checked_date = (now() at time zone 'Asia/Manila')::date
        and c.status = 'success'
        and c.metadata ->> 'all_variations_unchanged' = 'true'
        and checked_product.platform = 'shopee'
        and checked_product.is_active
        and checked_product.tracking_enabled
    ) as same_price_deferred
  from public.products p;
$$;

revoke all on function public.collector_available_summary_v2() from public, anon, authenticated;
grant execute on function public.collector_available_summary_v2() to service_role;
