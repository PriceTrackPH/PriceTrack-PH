-- Feature 6: exact product-status schedules and ordered fallback outcomes.
-- Sold Out: 15 days after first detection, then 30 days after the second and later detections.
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
        when p_status = 'success' and v_skip_unchanged_day and v_all_variations_unchanged then
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


alter table public.public_collection_requests
  add column if not exists consecutive_sold_out_checks integer not null default 0
    check (consecutive_sold_out_checks >= 0);

alter table public.store_collection_requests
  add column if not exists consecutive_sold_out_checks integer not null default 0
    check (consecutive_sold_out_checks >= 0);

create or replace function public.mark_collector_product_outcome(
  p_claim_source text,
  p_queue_request_id uuid,
  p_product_id bigint,
  p_external_shop_id text,
  p_external_product_id text,
  p_outcome text,
  p_checked_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id bigint;
  v_sold_out_count integer := 0;
  v_unavailable_count integer := 0;
  v_page_error_count integer := 0;
  v_delay interval;
  v_eligible_at timestamptz;
begin
  if p_claim_source not in ('priority', 'store', 'random')
    or p_outcome not in ('sold_out', 'does_not_exist', 'unlisted', 'page_error')
    or p_external_shop_id !~ '^[0-9]+$'
    or p_external_product_id !~ '^[0-9]+$' then
    raise exception 'invalid collector outcome';
  end if;

  select p.id into v_product_id
  from public.products p
  where p.platform = 'shopee'
    and p.external_shop_id = p_external_shop_id
    and p.external_product_id = p_external_product_id
  limit 1
  for update;

  if p_claim_source = 'random'
    and (p_product_id is null or v_product_id is distinct from p_product_id) then
    raise exception 'collector product identity mismatch';
  end if;

  if p_outcome = 'sold_out' then
    if v_product_id is not null then
      select p.consecutive_sold_out_checks into v_sold_out_count
      from public.products p where p.id = v_product_id;
    elsif p_claim_source = 'priority' then
      select r.consecutive_sold_out_checks into v_sold_out_count
      from public.public_collection_requests r
      where r.request_id = p_queue_request_id for update;
    else
      select r.consecutive_sold_out_checks into v_sold_out_count
      from public.store_collection_requests r
      where r.request_id = p_queue_request_id for update;
    end if;
    v_sold_out_count := coalesce(v_sold_out_count, 0) + 1;
    v_delay := case when v_sold_out_count = 1
      then interval '15 days' else interval '30 days' end;

  elsif p_outcome in ('does_not_exist', 'unlisted') then
    if v_product_id is not null then
      select p.consecutive_unavailable_checks into v_unavailable_count
      from public.products p where p.id = v_product_id;
    elsif p_claim_source = 'priority' then
      select r.consecutive_unavailable_checks into v_unavailable_count
      from public.public_collection_requests r
      where r.request_id = p_queue_request_id for update;
    else
      select r.consecutive_unavailable_checks into v_unavailable_count
      from public.store_collection_requests r
      where r.request_id = p_queue_request_id for update;
    end if;
    v_unavailable_count := coalesce(v_unavailable_count, 0) + 1;
    v_delay := case when v_unavailable_count = 1
      then interval '15 days' else interval '30 days' end;

  else
    if v_product_id is not null then
      select p.consecutive_page_errors into v_page_error_count
      from public.products p where p.id = v_product_id;
    elsif p_claim_source = 'priority' then
      select r.consecutive_page_errors into v_page_error_count
      from public.public_collection_requests r
      where r.request_id = p_queue_request_id for update;
    else
      select r.consecutive_page_errors into v_page_error_count
      from public.store_collection_requests r
      where r.request_id = p_queue_request_id for update;
    end if;
    v_page_error_count := coalesce(v_page_error_count, 0) + 1;
    v_delay := case
      when v_page_error_count = 1 then interval '0 seconds'
      when v_page_error_count = 2 then interval '15 days'
      else interval '30 days'
    end;
  end if;

  v_eligible_at := coalesce(p_checked_at, now()) + v_delay;

  if v_product_id is not null then
    update public.products p
    set collector_page_outcome = p_outcome,
        consecutive_sold_out_checks = case
          when p_outcome = 'sold_out' then v_sold_out_count
          else p.consecutive_sold_out_checks
        end,
        consecutive_unavailable_checks = case
          when p_outcome in ('does_not_exist', 'unlisted') then v_unavailable_count
          else p.consecutive_unavailable_checks
        end,
        consecutive_page_errors = case
          when p_outcome = 'page_error' then v_page_error_count
          else p.consecutive_page_errors
        end,
        all_variations_sold_out = case
          when p_outcome = 'sold_out' then true
          else p.all_variations_sold_out
        end,
        stock_status_checked_at = case
          when p_outcome = 'sold_out' then coalesce(p_checked_at, now())
          else p.stock_status_checked_at
        end,
        next_check_at = v_eligible_at,
        last_check_attempt_at = coalesce(p_checked_at, now()),
        last_check_status = case when p_outcome = 'sold_out' then 'success' else 'failure' end,
        check_lease_until = null
    where p.id = v_product_id;
  end if;

  if p_claim_source = 'priority' then
    update public.public_collection_requests r
    set status = case when v_eligible_at > now() then 'leased' else 'pending' end,
        lease_until = case when v_eligible_at > now() then v_eligible_at else null end,
        eligible_at = v_eligible_at,
        collector_page_outcome = p_outcome,
        consecutive_sold_out_checks = case
          when p_outcome = 'sold_out' then v_sold_out_count
          else r.consecutive_sold_out_checks
        end,
        consecutive_unavailable_checks = case
          when p_outcome in ('does_not_exist', 'unlisted') then v_unavailable_count
          else r.consecutive_unavailable_checks
        end,
        consecutive_page_errors = case
          when p_outcome = 'page_error' then v_page_error_count
          else r.consecutive_page_errors
        end,
        updated_at = now()
    where r.request_id = p_queue_request_id
      and r.external_shop_id = p_external_shop_id
      and r.external_product_id = p_external_product_id;

  elsif p_claim_source = 'store' then
    update public.store_collection_requests r
    set status = case when v_eligible_at > now() then 'leased' else 'pending' end,
        lease_until = case when v_eligible_at > now() then v_eligible_at else null end,
        eligible_at = v_eligible_at,
        collector_page_outcome = p_outcome,
        consecutive_sold_out_checks = case
          when p_outcome = 'sold_out' then v_sold_out_count
          else r.consecutive_sold_out_checks
        end,
        consecutive_unavailable_checks = case
          when p_outcome in ('does_not_exist', 'unlisted') then v_unavailable_count
          else r.consecutive_unavailable_checks
        end,
        consecutive_page_errors = case
          when p_outcome = 'page_error' then v_page_error_count
          else r.consecutive_page_errors
        end,
        updated_at = now()
    where r.request_id = p_queue_request_id
      and r.external_shop_id = p_external_shop_id
      and r.external_product_id = p_external_product_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'outcome', p_outcome,
    'eligibleAt', v_eligible_at,
    'recheckAt', case when v_delay > interval '0 seconds' then v_eligible_at else null end,
    'retryAfterCurrentRun', p_outcome = 'page_error' and v_page_error_count = 1
  );
end;
$$;

create or replace function public.reset_collector_page_outcome_on_success()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_sold_out boolean :=
    coalesce((new.metadata ->> 'all_variations_sold_out')::boolean, false);
begin
  if new.status = 'success' then
    update public.products
    set collector_page_outcome = case when v_is_sold_out then 'sold_out' else null end,
        consecutive_sold_out_checks = case
          when v_is_sold_out then consecutive_sold_out_checks else 0 end,
        consecutive_unavailable_checks = 0,
        consecutive_page_errors = 0
    where id = new.product_id;

    update public.public_collection_requests
    set collector_page_outcome = case when v_is_sold_out then 'sold_out' else null end,
        consecutive_sold_out_checks = case
          when v_is_sold_out then consecutive_sold_out_checks else 0 end,
        consecutive_unavailable_checks = 0,
        consecutive_page_errors = 0
    where platform = 'shopee'
      and external_shop_id = (
        select external_shop_id from public.products where id = new.product_id
      )
      and external_product_id = (
        select external_product_id from public.products where id = new.product_id
      );

    update public.store_collection_requests
    set collector_page_outcome = case when v_is_sold_out then 'sold_out' else null end,
        consecutive_sold_out_checks = case
          when v_is_sold_out then consecutive_sold_out_checks else 0 end,
        consecutive_unavailable_checks = 0,
        consecutive_page_errors = 0
    where platform = 'shopee'
      and external_shop_id = (
        select external_shop_id from public.products where id = new.product_id
      )
      and external_product_id = (
        select external_product_id from public.products where id = new.product_id
      );
  end if;
  return new;
end;
$$;

revoke all on function public.mark_collector_product_outcome(
  text,uuid,bigint,text,text,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.mark_collector_product_outcome(
  text,uuid,bigint,text,text,text,timestamptz
) to service_role;

revoke all on function public.reset_collector_page_outcome_on_success()
  from public, anon, authenticated;
grant execute on function public.reset_collector_page_outcome_on_success()
  to service_role;
