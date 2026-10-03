-- SQ contains first-time discoveries; recorded product rows remain in products for NQ.
create or replace function public.keep_recorded_products_out_of_sq()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.products p
    where p.platform = new.platform and p.external_shop_id = new.external_shop_id
      and p.external_product_id = new.external_product_id and p.last_checked_at is not null
  ) then
    if tg_op = 'INSERT' then return null; end if;
    new.status := 'completed';
    new.lease_until := null;
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  return new;
end;
$$;
revoke all on function public.keep_recorded_products_out_of_sq() from public, anon, authenticated;
create trigger keep_recorded_products_out_of_sq before insert or update
on public.store_collection_requests for each row execute function public.keep_recorded_products_out_of_sq();

create or replace function public.remove_recorded_product_from_sq()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.last_checked_at is not null then
    delete from public.store_collection_requests r
    where r.platform = new.platform and r.external_shop_id = new.external_shop_id
      and r.external_product_id = new.external_product_id;
  end if;
  return new;
end;
$$;
revoke all on function public.remove_recorded_product_from_sq() from public, anon, authenticated;
create trigger remove_recorded_product_from_sq after insert or update of last_checked_at
on public.products for each row execute function public.remove_recorded_product_from_sq();

CREATE OR REPLACE FUNCTION public.claim_oldest_store_collection_request(p_excluded_request_ids uuid[], p_lease_until timestamp with time zone)
 RETURNS TABLE(request_id uuid, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_sold_out_turn boolean;
  v_last_shop_id text;
  v_cycle_shops text[];
begin
  if p_lease_until is null or p_lease_until <= now() then
    raise exception 'lease must end in the future';
  end if;

  with expired as (
    select r.request_id
    from public.store_collection_requests r
    where r.status = 'leased' and r.lease_until < now()
    for update skip locked
  )
  update public.store_collection_requests r
  set status = 'pending', lease_until = null, updated_at = now()
  from expired
  where r.request_id = expired.request_id;

  -- Serialize claims so the 25:1 cadence survives page reloads and runs.
  select available_since_sold_out >= 25, last_shop_id, cycle_shop_ids
    into v_sold_out_turn, v_last_shop_id, v_cycle_shops
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
      and p.id is null
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
      case when not v_sold_out_turn and r.external_shop_id = any(v_cycle_shops) then 1 else 0 end,
      case when r.external_shop_id = v_last_shop_id then 1 else 0 end,
      pg_catalog.random()
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
    set available_since_sold_out = case
          when due.is_sold_out then 0
          when v_sold_out_turn then 1
          else least(25, state.available_since_sold_out + 1)
        end,
        cycle_shop_ids = case
          when due.is_sold_out then '{}'::text[]
          when v_sold_out_turn then array[leased.external_shop_id]
          when leased.external_shop_id = any(state.cycle_shop_ids) then state.cycle_shop_ids
          else pg_catalog.array_append(state.cycle_shop_ids, leased.external_shop_id)
        end,
        last_shop_id = leased.external_shop_id
    from due, leased
    where state.id = 1 and due.request_id = leased.request_id
    returning state.id
  )
  select leased.request_id, leased.external_shop_id,
         leased.external_product_id, leased.product_url, leased.lease_until
  from leased join counted on true;
end;
$function$;
create or replace function public.store_collection_queue_pending_count()
returns bigint language sql stable security definer set search_path = '' as $$
select count(*) from public.store_collection_requests r
where r.status in ('pending','leased') and r.eligible_at <= now()
and not exists (select 1 from public.products p where p.platform=r.platform
and p.external_shop_id=r.external_shop_id and p.external_product_id=r.external_product_id);
$$;

-- Remove only SQ request rows whose product has already been recorded.
delete from public.store_collection_requests r using public.products p
where p.platform=r.platform and p.external_shop_id=r.external_shop_id
and p.external_product_id=r.external_product_id and p.last_checked_at is not null;
