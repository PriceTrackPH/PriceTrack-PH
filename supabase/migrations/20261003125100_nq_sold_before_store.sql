CREATE OR REPLACE FUNCTION public.claim_random_available_product_check_v2(p_excluded_product_ids bigint[] DEFAULT '{}'::bigint[], p_skip_sold_out boolean DEFAULT true, p_last_shop_id text DEFAULT NULL::text)
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        select 1 from public.product_daily_checks c
        where c.product_id = p.id
          and c.checked_date = (now() at time zone 'Asia/Manila')::date
          and c.status = 'success'
      )
    order by
      case
        when coalesce(p.all_variations_sold_out, false) then 2
        when p.collector_page_outcome in ('does_not_exist', 'unlisted', 'page_error') then 1
        else 0
      end,
      p.total_sold desc nulls last,
      case when p.external_shop_id = p_last_shop_id then 1 else 0 end,
      p.favorite_count desc nulls last,
      p.review_count desc nulls last,
      p.rating desc nulls last,
      coalesce(p.next_check_at, p.created_at),
      p.id
    limit 1
    for update skip locked
  ), leased as (
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
$function$
;