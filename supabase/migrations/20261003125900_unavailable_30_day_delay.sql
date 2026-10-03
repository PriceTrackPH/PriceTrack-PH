CREATE OR REPLACE FUNCTION public.mark_collector_product_outcome(p_claim_source text, p_queue_request_id uuid, p_product_id bigint, p_external_shop_id text, p_external_product_id text, p_outcome text, p_checked_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    v_delay := interval '30 days';

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
      when v_page_error_count = 2 then interval '30 days'
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
$function$
;