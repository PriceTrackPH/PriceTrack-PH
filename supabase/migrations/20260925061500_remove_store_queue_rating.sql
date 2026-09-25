-- Store Queue ratings are untrustworthy; preserve product ratings for Normal Queue.
create or replace function public.upsert_store_listing_metadata(p_scan_id uuid, p_products jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product jsonb;
  v_shop_id text;
  v_product_id text;
  v_total_sold bigint;
  v_sales_activity text;
  v_rating numeric;
  v_review_count bigint;
  v_updated integer := 0;
begin
  if p_scan_id is null or p_products is null
    or pg_catalog.jsonb_typeof(p_products) <> 'array'
    or pg_catalog.jsonb_array_length(p_products) > 5000
    or not exists (select 1 from public.store_scan_history where scan_id = p_scan_id) then
    raise exception 'invalid store metadata batch';
  end if;

  for v_product in select value from pg_catalog.jsonb_array_elements(p_products)
  loop
    v_shop_id := v_product ->> 'shopId';
    v_product_id := coalesce(v_product ->> 'externalProductId', v_product ->> 'productId');
    if v_shop_id is null or v_shop_id !~ '^[1-9][0-9]*$'
      or v_product_id is null or v_product_id !~ '^[1-9][0-9]*$' then
      raise exception 'invalid product identity';
    end if;

    v_total_sold := case when coalesce(v_product ->> 'totalSold', '') ~ '^\d{1,18}$'
      then (v_product ->> 'totalSold')::bigint else null end;
    v_sales_activity := nullif(pg_catalog.btrim(v_product ->> 'salesActivity'), '');
    if pg_catalog.char_length(v_sales_activity) > 100 then v_sales_activity := null; end if;
    v_rating := case when coalesce(v_product ->> 'rating', '') ~ '^\d(?:\.\d+)?$'
      and (v_product ->> 'rating')::numeric between 0 and 5
      then (v_product ->> 'rating')::numeric else null end;
    v_review_count := case when coalesce(v_product ->> 'reviewCount', '') ~ '^\d{1,18}$'
      then (v_product ->> 'reviewCount')::bigint else null end;

    update public.store_scan_discoveries
    set total_sold = coalesce(v_total_sold, total_sold),
        shopee_sales_activity = coalesce(v_sales_activity, shopee_sales_activity),
        listing_review_count = coalesce(v_review_count, listing_review_count)
    where scan_id = p_scan_id
      and external_shop_id = v_shop_id
      and external_product_id = v_product_id;

    update public.store_collection_requests
    set total_sold = coalesce(v_total_sold, total_sold),
        shopee_sales_activity = coalesce(v_sales_activity, shopee_sales_activity),
        listing_review_count = coalesce(v_review_count, listing_review_count),
        updated_at = now()
    where platform = 'shopee'
      and external_shop_id = v_shop_id
      and external_product_id = v_product_id;

    update public.products
    set total_sold = coalesce(v_total_sold, total_sold),
        shopee_sales_activity = coalesce(v_sales_activity, shopee_sales_activity),
        rating = coalesce(v_rating, rating),
        review_count = coalesce(v_review_count, review_count),
        activity_observed_at = case
          when v_total_sold is not null or v_sales_activity is not null or v_rating is not null or v_review_count is not null then now()
          else activity_observed_at
        end,
        updated_at = now()
    where platform = 'shopee'
      and external_shop_id = v_shop_id
      and external_product_id = v_product_id;

    v_updated := v_updated + 1;
  end loop;
  return v_updated;
end;
$$;


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
begin
  if p_lease_until is null or p_lease_until <= now() then
    raise exception 'lease must end in the future';
  end if;

  update public.store_collection_requests
  set status = 'pending', lease_until = null, updated_at = now()
  where status = 'leased' and lease_until < now();

  return query
  with due as (
    select r.request_id
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
      case
        when coalesce(r.discovered_sold_out, false)
          or coalesce(p.all_variations_sold_out, false) then 2
        when coalesce(r.collector_page_outcome, p.collector_page_outcome)
          in ('does_not_exist', 'unlisted', 'page_error') then 1
        else 0
      end,
      coalesce(p.total_sold, r.total_sold) desc nulls last,
      case when coalesce(p.shopee_sales_activity, r.shopee_sales_activity) is null then 1 else 0 end,
      coalesce(p.review_count, r.listing_review_count) desc nulls last,
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
  )
  select leased.request_id, leased.external_shop_id,
         leased.external_product_id, leased.product_url, leased.lease_until
  from leased;
end;
$$;


alter table public.store_collection_requests drop column listing_rating;
alter table public.store_scan_discoveries drop column listing_rating;
