create or replace function public.claim_nq_cycle_product(
  p_mode text,
  p_excluded_product_ids bigint[] default '{}'::bigint[],
  p_last_shop_id text default null
) returns table(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamptz)
language plpgsql security definer set search_path='' as $function$
begin
  if p_mode not in ('low','unavailable') then raise exception 'invalid NQ cycle mode'; end if;
  return query
  with candidate as (
    select p.id from public.products p
    where p.platform='shopee' and p.is_active and p.tracking_enabled
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
revoke all on function public.claim_nq_cycle_product(text,bigint[],text) from public,anon,authenticated;
grant execute on function public.claim_nq_cycle_product(text,bigint[],text) to service_role;
