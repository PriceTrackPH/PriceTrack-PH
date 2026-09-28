-- Remove review-count storage from Store Queue and per-scan discoveries.
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

    v_rating := case when coalesce(v_product ->> 'rating', '') ~ '^\d(?:\.\d+)?$'
      and (v_product ->> 'rating')::numeric between 0 and 5
      then (v_product ->> 'rating')::numeric else null end;
    v_review_count := case when coalesce(v_product ->> 'reviewCount', '') ~ '^\d{1,18}$'
      then (v_product ->> 'reviewCount')::bigint else null end;

    update public.products
    set rating = coalesce(v_rating, rating),
        review_count = coalesce(v_review_count, review_count),
        activity_observed_at = case
          when v_rating is not null or v_review_count is not null then now()
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


alter table public.store_collection_requests drop column listing_review_count;
alter table public.store_scan_discoveries drop column listing_review_count;
