CREATE OR REPLACE FUNCTION public.claim_collector_backlog_product_v3(p_backlog_id uuid, p_skip_sold_out boolean, p_skip_unchanged_day boolean, p_last_shop_id text default null)
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  return query
  with due as (
    select p.id from public.collector_backlog_products bp
    join public.products p on p.id = bp.product_id
    where bp.backlog_id = p_backlog_id and bp.completed_at is null
      and p.is_active and p.tracking_enabled
      and (not p_skip_sold_out or p.all_variations_sold_out is distinct from true)
      and (p.check_lease_until is null or p.check_lease_until < now())
      and not exists (select 1 from public.product_daily_checks d
        where d.product_id = p.id and d.checked_date = (now() at time zone 'Asia/Manila')::date
          and d.status = 'success')
      and (not p_skip_unchanged_day or p.next_check_at is null or p.next_check_at <= now()
        or not exists (select 1 from public.product_daily_checks previous
          where previous.product_id = p.id
            and previous.checked_date = (now() at time zone 'Asia/Manila')::date - 1
            and previous.status = 'success'
            and previous.metadata ->> 'skip_unchanged_day' = 'true'
            and previous.metadata ->> 'all_variations_unchanged' = 'true'))
    order by case
      when coalesce(p.all_variations_sold_out,false) then 2
      when p.collector_page_outcome in ('does_not_exist','unlisted','page_error') then 1
      else 0 end,
      p.total_sold desc nulls last,
      case when p.external_shop_id=p_last_shop_id then 1 else 0 end,
      p.favorite_count desc nulls last,
      p.review_count desc nulls last,
      p.rating desc nulls last,
      coalesce(p.next_check_at, p.created_at),
      p.id
    limit 1 for update of p skip locked
  ), leased as (
    update public.products p set check_lease_until = now() + interval '10 minutes',
      last_check_attempt_at = now() from due where p.id = due.id
    returning p.id, p.external_shop_id, p.external_product_id, p.product_url, p.check_lease_until
  )
  select leased.id, leased.external_shop_id, leased.external_product_id,
    leased.product_url, leased.check_lease_until from leased;
end;
$function$
;
revoke all on function public.claim_collector_backlog_product_v3(uuid,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_collector_backlog_product_v3(uuid,boolean,boolean,text) to service_role;
