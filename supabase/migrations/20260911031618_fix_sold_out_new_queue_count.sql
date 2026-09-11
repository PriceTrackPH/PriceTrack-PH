-- Count every newly inserted store queue request as newly queued,
-- including sold-out products. Sold-out requests remain deferred for 15 days.

create or replace function public.import_store_collection_batch(
  p_scan_id uuid,
  p_products jsonb,
  p_pages_current integer,
  p_pages_total integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.collection_stores%rowtype;
  v_product jsonb;
  v_shop_id text;
  v_product_id text;
  v_product_url text;
  v_sold_out boolean;
  v_previous_sold_out boolean;
  v_discovered integer := 0;
  v_newly_queued integer := 0;
  v_duplicate integer := 0;
  v_already_tracked integer := 0;
  v_sold_out_count integer := 0;
  v_result public.store_scan_history%rowtype;
begin
  if p_scan_id is null or p_products is null or pg_catalog.jsonb_typeof(p_products) <> 'array'
    or pg_catalog.jsonb_array_length(p_products) > 5000
    or p_pages_current is null or p_pages_current < 0
    or p_pages_total is null or p_pages_total < 0
    or (p_pages_total > 0 and p_pages_current > p_pages_total) then
    raise exception 'invalid store batch';
  end if;

  select s.* into v_store
  from public.collection_stores s
  where s.last_scan_id = p_scan_id
  for update;
  if not found then raise exception 'unknown store scan'; end if;

  perform 1 from public.store_scan_history h where h.scan_id = p_scan_id for update;
  if not found then raise exception 'unknown store scan history'; end if;

  for v_product in select value from pg_catalog.jsonb_array_elements(p_products)
  loop
    v_shop_id := v_product ->> 'shopId';
    v_product_id := coalesce(v_product ->> 'externalProductId', v_product ->> 'productId');
    v_product_url := v_product ->> 'productUrl';
    v_sold_out := coalesce((v_product ->> 'soldOut')::boolean, false);
    if v_shop_id is null or v_shop_id !~ '^[1-9][0-9]*$'
      or v_product_id is null or v_product_id !~ '^[1-9][0-9]*$'
      or v_product_url is null or v_product_url = '' then
      raise exception 'invalid product identity';
    end if;

    select d.sold_out into v_previous_sold_out
    from public.store_scan_discoveries d
    where d.scan_id = p_scan_id
      and d.external_shop_id = v_shop_id
      and d.external_product_id = v_product_id;

    if found then
      if v_sold_out and not v_previous_sold_out then
        update public.store_scan_discoveries
        set sold_out = true
        where scan_id = p_scan_id
          and external_shop_id = v_shop_id
          and external_product_id = v_product_id;
        v_sold_out_count := v_sold_out_count + 1;
        update public.store_collection_requests
        set discovered_sold_out = true,
            eligible_at = greatest(eligible_at, now() + interval '15 days'),
            updated_at = now()
        where platform = 'shopee'
          and external_shop_id = v_shop_id
          and external_product_id = v_product_id
          and status = 'pending';
        update public.products
        set all_variations_sold_out = true,
            next_check_at = greatest(coalesce(next_check_at, now()), now() + interval '15 days')
        where platform = 'shopee'
          and external_shop_id = v_shop_id
          and external_product_id = v_product_id;
      end if;
      continue;
    end if;

    insert into public.store_scan_discoveries (
      scan_id, external_shop_id, external_product_id, sold_out
    ) values (
      p_scan_id, v_shop_id, v_product_id, v_sold_out
    );
    v_discovered := v_discovered + 1;
    if v_sold_out then v_sold_out_count := v_sold_out_count + 1; end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('store:shopee:' || v_shop_id || ':' || v_product_id, 0)
    );

    if exists (
      select 1 from public.products p
      where p.platform = 'shopee'
        and p.external_shop_id = v_shop_id
        and p.external_product_id = v_product_id
    ) then
      v_already_tracked := v_already_tracked + 1;
      if v_sold_out then
        update public.products
        set all_variations_sold_out = true,
            next_check_at = greatest(coalesce(next_check_at, now()), now() + interval '15 days')
        where platform = 'shopee'
          and external_shop_id = v_shop_id
          and external_product_id = v_product_id;
      end if;
    elsif exists (
      select 1 from public.store_collection_requests r
      where r.platform = 'shopee'
        and r.external_shop_id = v_shop_id
        and r.external_product_id = v_product_id
    ) then
      update public.store_collection_requests
      set last_seen_at = now(),
          discovered_sold_out = discovered_sold_out or v_sold_out,
          eligible_at = case
            when v_sold_out and status = 'pending'
              then greatest(eligible_at, now() + interval '15 days')
            else eligible_at
          end,
          updated_at = now()
      where platform = 'shopee'
        and external_shop_id = v_shop_id
        and external_product_id = v_product_id;
      v_duplicate := v_duplicate + 1;
    else
      insert into public.store_collection_requests (
        store_id, platform, external_shop_id, external_product_id, product_url,
        discovered_sold_out, eligible_at
      ) values (
        v_store.store_id, 'shopee', v_shop_id, v_product_id, v_product_url,
        v_sold_out, case when v_sold_out then now() + interval '15 days' else now() end
      );
      -- Sold-out items are still newly queued; only their eligibility is deferred.
      v_newly_queued := v_newly_queued + 1;
    end if;
  end loop;

  update public.store_scan_history h
  set discovered = h.discovered + v_discovered,
      newly_queued = h.newly_queued + v_newly_queued,
      duplicate = h.duplicate + v_duplicate,
      already_tracked = h.already_tracked + v_already_tracked,
      sold_out = h.sold_out + v_sold_out_count,
      pages_current = greatest(h.pages_current, p_pages_current),
      pages_total = greatest(h.pages_total, p_pages_total)
  where h.scan_id = p_scan_id
  returning * into v_result;

  update public.collection_stores s
  set last_discovered = v_result.discovered,
      last_newly_queued = v_result.newly_queued,
      last_duplicate = v_result.duplicate,
      last_already_tracked = v_result.already_tracked,
      last_sold_out = v_result.sold_out,
      last_pages_current = v_result.pages_current,
      last_pages_total = v_result.pages_total,
      updated_at = now()
  where s.store_id = v_store.store_id;

  return pg_catalog.jsonb_build_object(
    'discovered', v_discovered,
    'newlyQueued', v_newly_queued,
    'duplicate', v_duplicate,
    'alreadyTracked', v_already_tracked,
    'soldOut', v_sold_out_count,
    'pagesCurrent', v_result.pages_current,
    'pagesTotal', v_result.pages_total
  );
end;
$$;

revoke all on function public.import_store_collection_batch(uuid,jsonb,integer,integer)
  from public, anon, authenticated;
grant execute on function public.import_store_collection_batch(uuid,jsonb,integer,integer)
  to service_role;
