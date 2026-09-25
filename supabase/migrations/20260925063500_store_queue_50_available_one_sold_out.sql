-- Alternate 50 available Store Queue claims with one sold-out claim.
-- Keep sales and discovery tie breakers; Store Queue ratings remain removed.
create table public.store_queue_selection_state (
  id smallint primary key default 1 check (id = 1),
  available_since_sold_out integer not null default 0
    check (available_since_sold_out between 0 and 50)
);
insert into public.store_queue_selection_state (id) values (1);
alter table public.store_queue_selection_state enable row level security;
revoke all on public.store_queue_selection_state from public, anon, authenticated;

create or replace function public.claim_oldest_store_collection_request(
  p_excluded_request_ids uuid[],
  p_lease_until timestamptz
)
returns table (
  request_id uuid,
  shop_id text,
  external_product_id text,
  product_url text,
  lease_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_sold_out_turn boolean;
begin
  if p_lease_until is null or p_lease_until <= now() then
    raise exception 'lease must end in the future';
  end if;

  update public.store_collection_requests
  set status = 'pending', lease_until = null, updated_at = now()
  where status = 'leased' and lease_until < now();

  -- Serialize claims so the 50:1 cadence survives page reloads and runs.
  select available_since_sold_out >= 50 into v_sold_out_turn
  from public.store_queue_selection_state where id = 1 for update;

  return query
  with due as (
    select r.request_id,
      (coalesce(r.discovered_sold_out, false) or coalesce(p.all_variations_sold_out, false)) as is_sold_out
    from public.store_collection_requests r
    left join public.products p
      on p.platform = r.platform
     and p.external_shop_id = r.external_shop_id
     and p.external_product_id = r.external_product_id
    where r.status = 'pending'
      and r.eligible_at <= now()
      and (r.lease_until is null or r.lease_until < now())
      and r.request_id <> all(coalesce(p_excluded_request_ids, '{}'::uuid[]))
    order by
      case when v_sold_out_turn
        then case when coalesce(r.discovered_sold_out, false) or coalesce(p.all_variations_sold_out, false) then 0 else 1 end
        else case when coalesce(r.discovered_sold_out, false) or coalesce(p.all_variations_sold_out, false) then 1 else 0 end
      end,
      case
        when coalesce(r.discovered_sold_out, false)
          or coalesce(p.all_variations_sold_out, false) then 2
        when coalesce(r.collector_page_outcome, p.collector_page_outcome)
          in ('does_not_exist', 'unlisted', 'page_error') then 1
        else 0
      end,
      coalesce(p.total_sold, r.total_sold) desc nulls last,
      p.estimated_daily_sales desc nulls last,
      case when coalesce(p.shopee_sales_activity, r.shopee_sales_activity) is null then 1 else 0 end,
      r.first_discovered_at asc,
      r.request_id asc
    limit 1
    for update of r skip locked
  ), leased as (
    update public.store_collection_requests r
    set status = 'leased',
        lease_until = p_lease_until,
        attempt_count = r.attempt_count + 1,
        updated_at = now()
    from due
    where r.request_id = due.request_id
    returning r.request_id, r.external_shop_id, r.external_product_id,
              r.product_url, r.lease_until
  ), counted as (
    update public.store_queue_selection_state state
    set available_since_sold_out = case when due.is_sold_out then 0
      else least(50, state.available_since_sold_out + 1) end
    from due, leased
    where state.id = 1 and due.request_id = leased.request_id
    returning state.id
  )
  select leased.request_id, leased.external_shop_id,
         leased.external_product_id, leased.product_url, leased.lease_until
  from leased join counted on true;
end;
$$;


