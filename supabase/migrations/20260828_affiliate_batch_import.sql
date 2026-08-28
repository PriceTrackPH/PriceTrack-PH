create or replace function public.import_product_affiliate_links(entries jsonb)
returns table (
  updated_count integer,
  skipped_existing_count integer,
  not_found_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  entry jsonb;
  target_id bigint;
  target_metadata jsonb;
  existing_url text;
  next_url text;
  updates integer := 0;
  skipped integer := 0;
  missing integer := 0;
begin
  if jsonb_typeof(entries) <> 'array' then
    raise exception 'entries must be a JSON array';
  end if;

  if jsonb_array_length(entries) > 10000 then
    raise exception 'entries exceed the 10000-row batch limit';
  end if;

  for entry in select value from jsonb_array_elements(entries)
  loop
    next_url := nullif(btrim(entry->>'affiliate_url'), '');
    if next_url is null or next_url !~ '^https://s\.shopee\.ph/' then
      continue;
    end if;

    select product.id, coalesce(product.metadata, '{}'::jsonb)
      into target_id, target_metadata
    from public.products as product
    where product.platform = 'shopee'
      and product.external_shop_id = entry->>'shop_id'
      and product.external_product_id = entry->>'product_id'
    limit 1;

    if target_id is null then
      missing := missing + 1;
      continue;
    end if;

    existing_url := coalesce(
      nullif(target_metadata->>'affiliate_url', ''),
      nullif(target_metadata->>'affiliateUrl', ''),
      nullif(target_metadata->>'affiliate_link', ''),
      nullif(target_metadata->>'affiliateLink', ''),
      nullif(target_metadata->'affiliate'->>'url', ''),
      nullif(target_metadata->'affiliate'->>'href', ''),
      nullif(target_metadata->'affiliate'->>'link', '')
    );

    if existing_url is not null then
      skipped := skipped + 1;
      target_id := null;
      continue;
    end if;

    update public.products
    set metadata = target_metadata || jsonb_build_object(
      'affiliate_url', next_url,
      'affiliate_source', 'shopee_affiliate_batch',
      'affiliate_updated_at', now()
    ),
    updated_at = now()
    where id = target_id;

    updates := updates + 1;
    target_id := null;
  end loop;

  return query select updates, skipped, missing;
end;
$$;

revoke execute on function public.import_product_affiliate_links(jsonb) from public, anon, authenticated;
grant execute on function public.import_product_affiliate_links(jsonb) to service_role;
