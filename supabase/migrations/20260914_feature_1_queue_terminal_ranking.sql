-- Feature 1: keep due deferred outcomes behind active normal products while preserving
-- the Priority-first and Store-Normal-Normal collector cadence.
create or replace function public.claim_random_available_product_check(
  p_excluded_product_ids bigint[] default '{}'::bigint[],
  p_skip_sold_out boolean default true
)
returns table(
  product_id bigint,
  shop_id text,
  external_product_id text,
  product_url text,
  lease_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select p.id
    from public.products p
    where p.platform = 'shopee'
      and p.is_active
      and p.tracking_enabled
      and (
        not coalesce(p_skip_sold_out, true)
        or coalesce(p.all_variations_sold_out, false) = false
      )
      and coalesce(p.next_check_at, now()) <= now()
      and (p.check_lease_until is null or p.check_lease_until < now())
      and p.id <> all(coalesce(p_excluded_product_ids, '{}'::bigint[]))
      and not exists (
        select 1
        from public.product_daily_checks c
        where c.product_id = p.id
          and c.checked_date = (now() at time zone 'Asia/Manila')::date
          and c.status = 'success'
      )
    order by
      -- Scheduled sold-out and unavailable/error rechecks stay near the end.
      case
        when coalesce(p.all_variations_sold_out, false) then 2
        when p.collector_page_outcome in ('does_not_exist', 'unlisted', 'page_error') then 1
        else 0
      end,
      -- Active products retain the approved activity ranking. Low/no activity
      -- naturally follows stronger activity because null values sort last.
      p.estimated_daily_sales desc nulls last,
      p.sales_activity_at desc nulls last,
      p.shopee_view_count desc nulls last,
      p.extension_visit_count_30d desc,
      p.last_checked_at desc nulls last,
      p.price_drop_at desc nulls last,
      p.current_discount_percent desc nulls last,
      p.total_sold desc nulls last,
      p.review_count desc nulls last,
      p.favorite_count desc nulls last,
      (coalesce(p.rating, 0) * least(coalesce(p.review_count, 0), 1000)) desc,
      coalesce(p.next_check_at, p.created_at),
      p.id
    limit 1
    for update skip locked
  ),
  leased as (
    update public.products p
    set check_lease_until = now() + interval '10 minutes',
        last_check_attempt_at = now()
    from due
    where p.id = due.id
    returning p.id, p.external_shop_id, p.external_product_id,
              p.product_url, p.check_lease_until
  )
  select leased.id, leased.external_shop_id, leased.external_product_id,
         leased.product_url, leased.check_lease_until
  from leased;
end;
$$;

revoke all on function public.claim_random_available_product_check(bigint[], boolean)
  from public, anon, authenticated;
grant execute on function public.claim_random_available_product_check(bigint[], boolean)
  to service_role;
