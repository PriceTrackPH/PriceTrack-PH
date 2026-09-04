update public.products p
set all_variations_sold_out = not exists (
  select 1
  from public.product_variations v
  where v.product_id = p.id
    and v.is_active
)
where exists (
  select 1
  from public.product_variations v
  where v.product_id = p.id
);

create or replace function public.collector_available_summary()
returns table (
  total_tracked bigint,
  total_due bigint,
  sold_out_deferred bigint
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
          select 1
          from public.product_variations v
          where v.product_id = p.id
            and v.is_active
        )
    ) as total_due,
    count(*) filter (
      where p.platform = 'shopee'
        and p.is_active
        and p.tracking_enabled
        and not exists (
          select 1
          from public.product_variations v
          where v.product_id = p.id
            and v.is_active
        )
    ) as sold_out_deferred
  from public.products p;
$$;

revoke all on function public.collector_available_summary() from public, anon, authenticated;
grant execute on function public.collector_available_summary() to service_role;

create or replace function public.claim_random_available_product_check(
  p_excluded_product_ids bigint[] default '{}'::bigint[]
)
returns table (
  product_id bigint,
  shop_id text,
  external_product_id text,
  product_url text,
  lease_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select p.id
    from public.products p
    where p.platform = 'shopee'
      and p.is_active
      and p.tracking_enabled
      and coalesce(p.all_variations_sold_out, false) = false
      and exists (
        select 1
        from public.product_variations v
        where v.product_id = p.id
          and v.is_active
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
    order by random()
    limit 1
    for update skip locked
  ), leased as (
    update public.products p
    set check_lease_until = now() + interval '10 minutes',
        last_check_attempt_at = now()
    from due
    where p.id = due.id
    returning p.id, p.external_shop_id, p.external_product_id, p.product_url, p.check_lease_until
  )
  select leased.id, leased.external_shop_id, leased.external_product_id, leased.product_url, leased.check_lease_until
  from leased;
end;
$$;

revoke all on function public.claim_random_available_product_check(bigint[]) from public, anon, authenticated;
grant execute on function public.claim_random_available_product_check(bigint[]) to service_role;
