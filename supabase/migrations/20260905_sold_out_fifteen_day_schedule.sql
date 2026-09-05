-- Recheck fully sold-out Shopee products every 15 days while keeping
-- available products on the existing daily schedule.

create or replace function public.mark_product_check(
  p_product_id bigint,
  p_checked_date date,
  p_checked_at timestamptz,
  p_source text,
  p_status text,
  p_variation_count integer,
  p_changed_count integer,
  p_unchanged_count integer,
  p_failed_count integer,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_all_sold_out boolean := coalesce((p_metadata ->> 'all_variations_sold_out')::boolean, false);
begin
  if p_source not in ('extension', 'scheduled_collector')
     or p_status not in ('success', 'partial', 'failure') then
    raise exception 'Invalid product check source or status';
  end if;

  insert into public.product_daily_checks (
    product_id, checked_date, checked_at, source, status,
    variation_count, changed_count, unchanged_count, failed_count, metadata
  ) values (
    p_product_id, p_checked_date, p_checked_at, p_source, p_status,
    greatest(0, least(coalesce(p_variation_count, 0), 200)),
    greatest(0, least(coalesce(p_changed_count, 0), 200)),
    greatest(0, least(coalesce(p_unchanged_count, 0), 200)),
    greatest(0, least(coalesce(p_failed_count, 0), 200)),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (product_id, checked_date) do update
  set checked_at = greatest(product_daily_checks.checked_at, excluded.checked_at),
      source = case when product_daily_checks.status = 'success' then product_daily_checks.source else excluded.source end,
      status = case when product_daily_checks.status = 'success' then 'success' else excluded.status end,
      variation_count = case when product_daily_checks.status = 'success' then product_daily_checks.variation_count else excluded.variation_count end,
      changed_count = case when product_daily_checks.status = 'success' then product_daily_checks.changed_count else excluded.changed_count end,
      unchanged_count = case when product_daily_checks.status = 'success' then product_daily_checks.unchanged_count else excluded.unchanged_count end,
      failed_count = case when product_daily_checks.status = 'success' then product_daily_checks.failed_count else excluded.failed_count end,
      metadata = case when product_daily_checks.status = 'success' then product_daily_checks.metadata else excluded.metadata end,
      updated_at = now();

  update public.products
  set last_check_attempt_at = p_checked_at,
      last_checked_at = case when p_status = 'success' then p_checked_at else last_checked_at end,
      last_check_status = p_status,
      consecutive_check_failures = case when p_status = 'success' then 0 else consecutive_check_failures + 1 end,
      all_variations_sold_out = case when p_status = 'success' then v_all_sold_out else all_variations_sold_out end,
      stock_status_checked_at = case when p_status = 'success' then p_checked_at else stock_status_checked_at end,
      next_check_at = case
        when p_status = 'success' and v_all_sold_out then p_checked_at + interval '15 days'
        when p_status = 'success' then p_checked_at + interval '24 hours'
        else now() + interval '6 hours'
      end,
      check_lease_until = null
  where id = p_product_id;
end;
$$;

revoke all on function public.mark_product_check(bigint,date,timestamptz,text,text,integer,integer,integer,integer,jsonb)
  from public, anon, authenticated;
grant execute on function public.mark_product_check(bigint,date,timestamptz,text,text,integer,integer,integer,integer,jsonb)
  to service_role;

-- Include both products already flagged sold out and legacy products whose
-- variations are all inactive, so the existing backlog follows the same rule.
update public.products p
set next_check_at = coalesce(
  p.stock_status_checked_at,
  p.last_checked_at,
  p.last_check_attempt_at,
  now()
) + interval '15 days',
    check_lease_until = null
where p.platform = 'shopee'
  and p.is_active
  and p.tracking_enabled
  and (
    p.all_variations_sold_out is true
    or not exists (
      select 1
      from public.product_variations v
      where v.product_id = p.id
        and v.is_active
    )
  );
