-- Include unrecorded priority and store requests in collector page outcome counters.
-- Tracked products remain authoritative when the same Shopee identity is in a queue.
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
  with tracked as (
    select
      count(*) filter (where p.platform = 'shopee' and p.is_active and p.tracking_enabled) as total_tracked,
      count(*) filter (
        where p.platform = 'shopee' and p.is_active and p.tracking_enabled
          and coalesce(p.next_check_at, now()) <= now()
          and exists (select 1 from public.product_variations v where v.product_id = p.id and v.is_active)
      ) as total_due,
      count(*) filter (
        where p.platform = 'shopee' and p.is_active and p.tracking_enabled
          and p.collector_page_outcome is distinct from 'does_not_exist'
          and p.collector_page_outcome is distinct from 'unlisted'
          and p.collector_page_outcome is distinct from 'page_error'
          and not exists (select 1 from public.product_variations v where v.product_id = p.id and v.is_active)
      ) as sold_out_deferred,
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
    from public.products p
  ), queue_outcomes as (
    select distinct on (q.shop_id, q.product_id)
      q.shop_id, q.product_id, q.outcome
    from (
      select r.external_shop_id as shop_id, r.external_product_id as product_id,
        r.collector_page_outcome as outcome, r.updated_at
      from public.public_collection_requests r
      where r.collector_page_outcome in ('does_not_exist', 'unlisted', 'page_error')
      union all
      select r.external_shop_id, r.external_product_id, r.collector_page_outcome, r.updated_at
      from public.store_collection_requests r
      where r.collector_page_outcome in ('does_not_exist', 'unlisted', 'page_error')
    ) q
    where not exists (
      select 1 from public.products p
      where p.platform = 'shopee' and p.is_active and p.tracking_enabled
        and p.external_shop_id = q.shop_id and p.external_product_id = q.product_id
    )
    order by q.shop_id, q.product_id, q.updated_at desc
  ), queue_counts as (
    select
      count(*) filter (where outcome = 'does_not_exist') as does_not_exist_count,
      count(*) filter (where outcome = 'unlisted') as unlisted_count,
      count(*) filter (where outcome = 'page_error') as page_error_count
    from queue_outcomes
  )
  select tracked.total_tracked, tracked.total_due, tracked.sold_out_deferred,
    (
      select count(*) from public.product_daily_checks c
      join public.products p on p.id = c.product_id
      where c.checked_date = (now() at time zone 'Asia/Manila')::date
        and c.status = 'success'
        and c.metadata ->> 'all_variations_unchanged' = 'true'
        and p.platform = 'shopee' and p.is_active and p.tracking_enabled
    ),
    tracked.does_not_exist_count + queue_counts.does_not_exist_count,
    tracked.unlisted_count + queue_counts.unlisted_count,
    tracked.page_error_count + queue_counts.page_error_count
  from tracked cross join queue_counts;
$$;
