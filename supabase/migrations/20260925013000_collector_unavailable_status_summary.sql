-- Keep product availability and Shopee page outcomes distinct.
-- v3 adds dedicated counters without changing the v2 function signature.
create or replace function public.collector_available_summary_v3()
returns table (
  total_tracked bigint,
  total_due bigint,
  sold_out_deferred bigint,
  same_price_deferred bigint,
  does_not_exist_count bigint,
  unlisted_count bigint,
  page_error_count bigint
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
      where p.platform = 'shopee' and p.is_active and p.tracking_enabled
        and coalesce(p.next_check_at, now()) <= now()
        and exists (
          select 1 from public.product_variations v
          where v.product_id = p.id and v.is_active
        )
    ) as total_due,
    count(*) filter (
      where p.platform = 'shopee' and p.is_active and p.tracking_enabled
        and p.collector_page_outcome is distinct from 'does_not_exist'
        and p.collector_page_outcome is distinct from 'unlisted'
        and p.collector_page_outcome is distinct from 'page_error'
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
    ) as same_price_deferred,
    count(*) filter (
      where p.platform = 'shopee' and p.is_active and p.tracking_enabled
        and p.collector_page_outcome = 'does_not_exist'
    ) as does_not_exist_count,
    count(*) filter (
      where p.platform = 'shopee' and p.is_active and p.tracking_enabled
        and p.collector_page_outcome = 'unlisted'
    ) as unlisted_count,
    count(*) filter (
      where p.platform = 'shopee' and p.is_active and p.tracking_enabled
        and p.collector_page_outcome = 'page_error'
    ) as page_error_count
  from public.products p;
$$;

revoke all on function public.collector_available_summary_v3()
  from public, anon, authenticated;
grant execute on function public.collector_available_summary_v3()
  to service_role;
