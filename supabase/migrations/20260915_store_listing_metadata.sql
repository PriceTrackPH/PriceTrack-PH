alter table public.store_scan_discoveries
  add column if not exists total_sold bigint,
  add column if not exists shopee_sales_activity text,
  add column if not exists listing_rating numeric,
  add column if not exists listing_review_count bigint;

alter table public.store_collection_requests
  add column if not exists total_sold bigint,
  add column if not exists shopee_sales_activity text,
  add column if not exists listing_rating numeric,
  add column if not exists listing_review_count bigint;

alter table public.products
  add column if not exists shopee_sales_activity text;

alter table public.store_scan_discoveries
  add constraint store_scan_discoveries_total_sold_check check (total_sold is null or total_sold >= 0),
  add constraint store_scan_discoveries_sales_activity_check check (shopee_sales_activity is null or char_length(shopee_sales_activity) <= 100),
  add constraint store_scan_discoveries_rating_check check (listing_rating is null or (listing_rating >= 0 and listing_rating <= 5)),
  add constraint store_scan_discoveries_review_count_check check (listing_review_count is null or listing_review_count >= 0);

alter table public.store_collection_requests
  add constraint store_collection_requests_total_sold_check check (total_sold is null or total_sold >= 0),
  add constraint store_collection_requests_sales_activity_check check (shopee_sales_activity is null or char_length(shopee_sales_activity) <= 100),
  add constraint store_collection_requests_rating_check check (listing_rating is null or (listing_rating >= 0 and listing_rating <= 5)),
  add constraint store_collection_requests_review_count_check check (listing_review_count is null or listing_review_count >= 0);

alter table public.products
  add constraint products_shopee_sales_activity_check check (shopee_sales_activity is null or char_length(shopee_sales_activity) <= 100);

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
        listing_rating = coalesce(v_rating, listing_rating),
        listing_review_count = coalesce(v_review_count, listing_review_count)
    where scan_id = p_scan_id
      and external_shop_id = v_shop_id
      and external_product_id = v_product_id;

    update public.store_collection_requests
    set total_sold = coalesce(v_total_sold, total_sold),
        shopee_sales_activity = coalesce(v_sales_activity, shopee_sales_activity),
        listing_rating = coalesce(v_rating, listing_rating),
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

revoke all on function public.upsert_store_listing_metadata(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.upsert_store_listing_metadata(uuid,jsonb) to service_role;
