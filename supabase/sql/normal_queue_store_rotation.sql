CREATE OR REPLACE FUNCTION public.claim_random_available_product_check_v2_rotation(p_excluded_product_ids bigint[] DEFAULT '{}'::bigint[], p_skip_sold_out boolean DEFAULT true, p_last_shop_id text DEFAULT NULL::text, p_excluded_shop_ids text[] DEFAULT '{}'::text[])
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
      and p.external_shop_id <> all(coalesce(p_excluded_shop_ids, '{}'::text[]))
      and p.is_active
      and p.tracking_enabled
      and (
        public.is_double_sale_day()
        or not coalesce(p_skip_sold_out, true)
        or coalesce(p.all_variations_sold_out, false) = false
      )
      and (
        public.is_double_sale_day()
        or coalesce(p.next_check_at, now()) <= now()
      )
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
$function$;
revoke all on function public.claim_random_available_product_check_v2_rotation(bigint[], boolean, text, text[]) from public, anon, authenticated;
grant execute on function public.claim_random_available_product_check_v2_rotation(bigint[], boolean, text, text[]) to service_role;
CREATE OR REPLACE FUNCTION public.claim_nq_cycle_product_rotation(p_mode text, p_excluded_product_ids bigint[] DEFAULT '{}'::bigint[], p_last_shop_id text DEFAULT NULL::text, p_excluded_shop_ids text[] DEFAULT '{}'::text[])
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_mode not in ('low','unavailable') then raise exception 'invalid NQ cycle mode'; end if;
  return query
  with candidate as (
    select p.id from public.products p
    where p.platform='shopee' and p.external_shop_id <> all(coalesce(p_excluded_shop_ids, '{}'::text[])) and p.is_active and p.tracking_enabled
      and (p.check_lease_until is null or p.check_lease_until < now())
      and p.id <> all(coalesce(p_excluded_product_ids,'{}'::bigint[]))
      and not exists(select 1 from public.product_daily_checks c
        where c.product_id=p.id and c.checked_date=(now() at time zone 'Asia/Manila')::date and c.status='success')
      and (
        (p_mode='low' and coalesce(p.next_check_at,now())<=now()
          and not coalesce(p.all_variations_sold_out,false)
          and coalesce(p.collector_page_outcome,'') not in ('does_not_exist','unlisted','page_error')
          and exists(select 1 from public.product_variations v where v.product_id=p.id and v.is_active))
        or (p_mode='unavailable'
          and (coalesce(p.all_variations_sold_out,false) or p.collector_page_outcome in ('sold_out','does_not_exist','unlisted','page_error'))
          and (p.last_check_attempt_at is null or (p.last_check_attempt_at at time zone 'Asia/Manila')::date < (now() at time zone 'Asia/Manila')::date))
      )
    order by
      case when p_mode='unavailable' then random() end,
      p.total_sold asc nulls first,
      case when p.external_shop_id=p_last_shop_id then 1 else 0 end,
      p.favorite_count asc nulls first,p.review_count asc nulls first,p.rating asc nulls first,
      coalesce(p.next_check_at,p.created_at) desc,p.id desc
    limit 1 for update skip locked
  ), leased as (
    update public.products p set check_lease_until=now()+interval '10 minutes',last_check_attempt_at=now()
    from candidate c where p.id=c.id
    returning p.id,p.external_shop_id,p.external_product_id,p.product_url,p.check_lease_until
  )
  select l.id,l.external_shop_id,l.external_product_id,l.product_url,l.check_lease_until from leased l;
end;
$function$;
revoke all on function public.claim_nq_cycle_product_rotation(text, bigint[], text, text[]) from public, anon, authenticated;
grant execute on function public.claim_nq_cycle_product_rotation(text, bigint[], text, text[]) to service_role;
CREATE OR REPLACE FUNCTION public.claim_collector_backlog_product_v4_rotation(p_backlog_id uuid, p_skip_sold_out boolean, p_skip_unchanged_day boolean, p_last_shop_id text DEFAULT NULL::text, p_exclude_product_ids bigint[] DEFAULT ARRAY[]::bigint[], p_excluded_shop_ids text[] DEFAULT '{}'::text[])
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
      and not (p.id = any(coalesce(p_exclude_product_ids, ARRAY[]::bigint[])))
      and p.external_shop_id <> all(coalesce(p_excluded_shop_ids, '{}'::text[]))
      and p.is_active and p.tracking_enabled
      and (public.is_double_sale_day() or not p_skip_sold_out or p.all_variations_sold_out is distinct from true)
      and (p.check_lease_until is null or p.check_lease_until < now())
      and not exists (select 1 from public.product_daily_checks d
        where d.product_id = p.id and d.checked_date = (now() at time zone 'Asia/Manila')::date
          and d.status = 'success')
      and (
        public.is_double_sale_day()
        or not p_skip_unchanged_day or p.next_check_at is null or p.next_check_at <= now()
        or not exists (select 1 from public.product_daily_checks previous
          where previous.product_id = p.id
            and previous.checked_date = (now() at time zone 'Asia/Manila')::date - 1
            and previous.status = 'success'
            and previous.metadata ->> 'skip_unchanged_day' = 'true'
            and previous.metadata ->> 'all_variations_unchanged' = 'true')
      )
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
$function$;
revoke all on function public.claim_collector_backlog_product_v4_rotation(uuid, boolean, boolean, text, bigint[], text[]) from public, anon, authenticated;
grant execute on function public.claim_collector_backlog_product_v4_rotation(uuid, boolean, boolean, text, bigint[], text[]) to service_role;
