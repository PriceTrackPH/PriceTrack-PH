-- The saved backlog can ignore other due dates, but it must honor the
-- one-day deferral created by the Same Price Products switch when enabled.
create or replace function public.claim_collector_backlog_product_v2(
  p_backlog_id uuid,
  p_skip_sold_out boolean,
  p_skip_unchanged_day boolean
)
returns table(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
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
    order by p.total_sold desc nulls last,
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
$$;

revoke all on function public.claim_collector_backlog_product_v2(uuid,boolean,boolean) from public, anon, authenticated;
grant execute on function public.claim_collector_backlog_product_v2(uuid,boolean,boolean) to service_role;
