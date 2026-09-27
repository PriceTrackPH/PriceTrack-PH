-- Protect monthly sale periods from the normal same-price next-day skip.
create or replace function public.shopee_sale_window(p_day date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_day is not null and (
    extract(day from p_day)::integer >= least(29, extract(day from date_trunc('month', p_day::timestamp) + interval '1 month - 1 day')::integer)
    or extract(day from p_day)::integer = 1
    or extract(day from p_day)::integer between 14 and 16
    or extract(day from p_day)::integer between extract(month from p_day)::integer - 1 and extract(month from p_day)::integer + 1
  );
$$;

revoke all on function public.shopee_sale_window(date) from public, anon, authenticated;
grant execute on function public.shopee_sale_window(date) to service_role;

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
  v_skip_sold_out boolean := coalesce((p_metadata ->> 'skip_sold_out')::boolean, true);
  v_skip_unchanged_day boolean := coalesce((p_metadata ->> 'skip_unchanged_day')::boolean, false);
  v_all_variations_unchanged boolean := coalesce((p_metadata ->> 'all_variations_unchanged')::boolean, false);
  v_already_successful_today boolean;
begin
  if p_source not in ('extension', 'scheduled_collector')
     or p_status not in ('success', 'partial', 'failure') then
    raise exception 'Invalid product check source or status';
  end if;

  select exists (
    select 1
    from public.product_daily_checks
    where product_id = p_product_id
      and checked_date = p_checked_date
      and status = 'success'
  ) into v_already_successful_today;

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
      consecutive_sold_out_checks = case
        when p_status = 'success' and not v_all_sold_out then 0
        when p_status = 'success' and v_all_sold_out and not v_already_successful_today
          then consecutive_sold_out_checks + 1
        else consecutive_sold_out_checks
      end,
      all_variations_sold_out = case when p_status = 'success' then v_all_sold_out else all_variations_sold_out end,
      stock_status_checked_at = case when p_status = 'success' then p_checked_at else stock_status_checked_at end,
      next_check_at = case
        when p_status = 'success' and v_all_sold_out and not v_skip_sold_out then
          (date_trunc('day', p_checked_at at time zone 'Asia/Manila') + interval '1 day')
            at time zone 'Asia/Manila'
        when p_status = 'success' and v_all_sold_out and v_skip_sold_out and v_already_successful_today then
          next_check_at
        when p_status = 'success' and v_all_sold_out and v_skip_sold_out and consecutive_sold_out_checks >= 1 then
          p_checked_at + interval '30 days'
        when p_status = 'success' and v_all_sold_out and v_skip_sold_out then
          p_checked_at + interval '15 days'
        when p_status = 'success' and v_skip_unchanged_day and v_all_variations_unchanged
          and not public.shopee_sale_window((p_checked_at at time zone 'Asia/Manila')::date)
          and not public.shopee_sale_window((p_checked_at at time zone 'Asia/Manila')::date + 1) then
          (date_trunc('day', p_checked_at at time zone 'Asia/Manila') + interval '2 days')
            at time zone 'Asia/Manila'
        when p_status = 'success' then
          (date_trunc('day', p_checked_at at time zone 'Asia/Manila') + interval '1 day')
            at time zone 'Asia/Manila'
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


