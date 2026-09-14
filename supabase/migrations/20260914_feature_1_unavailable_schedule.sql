-- Feature 1: remember terminal Shopee outcomes and defer repeat checks.
alter table public.products
  add column if not exists collector_page_outcome text,
  add column if not exists consecutive_unavailable_checks integer not null default 0,
  add column if not exists consecutive_page_errors integer not null default 0;

alter table public.public_collection_requests
  add column if not exists eligible_at timestamptz not null default now(),
  add column if not exists collector_page_outcome text,
  add column if not exists consecutive_unavailable_checks integer not null default 0,
  add column if not exists consecutive_page_errors integer not null default 0;

alter table public.store_collection_requests
  add column if not exists eligible_at timestamptz not null default now(),
  add column if not exists collector_page_outcome text,
  add column if not exists consecutive_unavailable_checks integer not null default 0,
  add column if not exists consecutive_page_errors integer not null default 0;

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
  v_unavailable_count integer := 0;
  v_page_error_count integer := 0;
  v_delay interval;
  v_eligible_at timestamptz;
begin
  if p_claim_source not in ('priority', 'store', 'random')
    or p_outcome not in ('does_not_exist', 'unlisted', 'page_error')
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

  if p_claim_source = 'random' and (p_product_id is null or v_product_id is distinct from p_product_id) then
    raise exception 'collector product identity mismatch';
  end if;

  if p_outcome in ('does_not_exist', 'unlisted') then
    if v_product_id is not null then
      select p.consecutive_unavailable_checks into v_unavailable_count
      from public.products p where p.id = v_product_id;
    elsif p_claim_source = 'priority' then
      select r.consecutive_unavailable_checks into v_unavailable_count
      from public.public_collection_requests r where r.request_id = p_queue_request_id for update;
    else
      select r.consecutive_unavailable_checks into v_unavailable_count
      from public.store_collection_requests r where r.request_id = p_queue_request_id for update;
    end if;
    v_unavailable_count := coalesce(v_unavailable_count, 0) + 1;
    v_delay := case when v_unavailable_count = 1 then interval '15 days' else interval '30 days' end;
  else
    if v_product_id is not null then
      select p.consecutive_page_errors into v_page_error_count
      from public.products p where p.id = v_product_id;
    elsif p_claim_source = 'priority' then
      select r.consecutive_page_errors into v_page_error_count
      from public.public_collection_requests r where r.request_id = p_queue_request_id for update;
    else
      select r.consecutive_page_errors into v_page_error_count
      from public.store_collection_requests r where r.request_id = p_queue_request_id for update;
    end if;
    v_page_error_count := coalesce(v_page_error_count, 0) + 1;
    -- First page error is released for a later run; second waits 15 days, then 30 days.
    v_delay := case when v_page_error_count = 1 then interval '0 seconds'
                    when v_page_error_count = 2 then interval '15 days'
                    else interval '30 days' end;
  end if;
  v_eligible_at := coalesce(p_checked_at, now()) + v_delay;

  if v_product_id is not null then
    update public.products p set
      collector_page_outcome = p_outcome,
      consecutive_unavailable_checks = case when p_outcome in ('does_not_exist', 'unlisted') then v_unavailable_count else p.consecutive_unavailable_checks end,
      consecutive_page_errors = case when p_outcome = 'page_error' then v_page_error_count else p.consecutive_page_errors end,
      next_check_at = v_eligible_at,
      last_check_attempt_at = coalesce(p_checked_at, now()),
      last_check_status = 'failure',
      check_lease_until = null
    where p.id = v_product_id;
  end if;

  if p_claim_source = 'priority' then
    update public.public_collection_requests r set
      status = case when v_eligible_at > now() then 'leased' else 'pending' end,
      lease_until = case when v_eligible_at > now() then v_eligible_at else null end,
      eligible_at = v_eligible_at,
      collector_page_outcome = p_outcome,
      consecutive_unavailable_checks = case when p_outcome in ('does_not_exist', 'unlisted') then v_unavailable_count else r.consecutive_unavailable_checks end,
      consecutive_page_errors = case when p_outcome = 'page_error' then v_page_error_count else r.consecutive_page_errors end,
      updated_at = now()
    where r.request_id = p_queue_request_id and r.external_shop_id = p_external_shop_id
      and r.external_product_id = p_external_product_id;
  elsif p_claim_source = 'store' then
    update public.store_collection_requests r set
      status = case when v_eligible_at > now() then 'leased' else 'pending' end,
      lease_until = case when v_eligible_at > now() then v_eligible_at else null end,
      eligible_at = v_eligible_at,
      collector_page_outcome = p_outcome,
      consecutive_unavailable_checks = case when p_outcome in ('does_not_exist', 'unlisted') then v_unavailable_count else r.consecutive_unavailable_checks end,
      consecutive_page_errors = case when p_outcome = 'page_error' then v_page_error_count else r.consecutive_page_errors end,
      updated_at = now()
    where r.request_id = p_queue_request_id and r.external_shop_id = p_external_shop_id
      and r.external_product_id = p_external_product_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'outcome', p_outcome,
    'eligibleAt', v_eligible_at,
    'retryAfterCurrentRun', p_outcome = 'page_error' and v_page_error_count = 1
  );
end;
$$;

create or replace function public.reclaim_collector_product(
  p_claim_source text, p_queue_request_id uuid, p_product_id bigint,
  p_external_shop_id text, p_external_product_id text, p_lease_until timestamptz
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_claimed integer := 0;
begin
  if p_lease_until is null or p_lease_until <= now() then raise exception 'invalid retry lease'; end if;
  if p_claim_source = 'random' then
    update public.products set check_lease_until=p_lease_until,last_check_attempt_at=now()
    where id=p_product_id and external_shop_id=p_external_shop_id and external_product_id=p_external_product_id
      and coalesce(next_check_at,now())<=now() and (check_lease_until is null or check_lease_until<now());
  elsif p_claim_source = 'priority' then
    update public.public_collection_requests set status='leased',lease_until=p_lease_until,attempt_count=attempt_count+1,updated_at=now()
    where request_id=p_queue_request_id and external_shop_id=p_external_shop_id and external_product_id=p_external_product_id
      and status='pending' and eligible_at<=now();
  elsif p_claim_source = 'store' then
    update public.store_collection_requests set status='leased',lease_until=p_lease_until,attempt_count=attempt_count+1,updated_at=now()
    where request_id=p_queue_request_id and external_shop_id=p_external_shop_id and external_product_id=p_external_product_id
      and status='pending' and eligible_at<=now();
  else raise exception 'invalid retry source';
  end if;
  get diagnostics v_claimed = row_count;
  return v_claimed > 0;
end;
$$;

create or replace function public.reset_collector_page_outcome_on_success()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'success' then
    update public.products set collector_page_outcome = null,
      consecutive_unavailable_checks = 0, consecutive_page_errors = 0
    where id = new.product_id;
    update public.public_collection_requests set collector_page_outcome = null,
      consecutive_unavailable_checks = 0, consecutive_page_errors = 0
    where platform = 'shopee' and external_shop_id = (select external_shop_id from public.products where id = new.product_id)
      and external_product_id = (select external_product_id from public.products where id = new.product_id);
    update public.store_collection_requests set collector_page_outcome = null,
      consecutive_unavailable_checks = 0, consecutive_page_errors = 0
    where platform = 'shopee' and external_shop_id = (select external_shop_id from public.products where id = new.product_id)
      and external_product_id = (select external_product_id from public.products where id = new.product_id);
  end if;
  return new;
end;
$$;

drop trigger if exists reset_collector_page_outcome_on_success on public.product_daily_checks;
create trigger reset_collector_page_outcome_on_success
after insert or update of status on public.product_daily_checks
for each row execute function public.reset_collector_page_outcome_on_success();

revoke all on function public.mark_collector_product_outcome(text,uuid,bigint,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.mark_collector_product_outcome(text,uuid,bigint,text,text,text,timestamptz) to service_role;
revoke all on function public.reclaim_collector_product(text,uuid,bigint,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.reclaim_collector_product(text,uuid,bigint,text,text,timestamptz) to service_role;
revoke all on function public.reset_collector_page_outcome_on_success() from public, anon, authenticated;
grant execute on function public.reset_collector_page_outcome_on_success() to service_role;
