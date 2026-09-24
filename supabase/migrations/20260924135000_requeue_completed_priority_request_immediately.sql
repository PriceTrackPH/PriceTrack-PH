create or replace function public.enqueue_public_collection_request(
  p_requester_hash text,
  p_external_shop_id text,
  p_external_product_id text,
  p_product_url text,
  p_requested_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_request public.public_collection_requests%rowtype;
  v_has_existing_request boolean;
  v_request_count integer;
begin
  if p_requester_hash is null or p_requester_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid requester hash';
  end if;

  if p_requested_date is null then
    raise exception 'requested date is required';
  end if;

  if p_external_shop_id is null or p_external_shop_id !~ '^[0-9]+$'
    or p_external_product_id is null or p_external_product_id !~ '^[0-9]+$'
    or p_product_url is null or p_product_url = '' then
    raise exception 'invalid product identity';
  end if;

  -- Serialize both existing and first-time requests for the same Shopee identity.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'shopee:' || p_external_shop_id || ':' || p_external_product_id,
      0
    )
  );

  select r.*
  into v_existing_request
  from public.public_collection_requests r
  where r.platform = 'shopee'
    and r.external_shop_id = p_external_shop_id
    and r.external_product_id = p_external_product_id
  for update;

  v_has_existing_request := found;

  if v_has_existing_request
    and v_existing_request.status in ('pending', 'leased') then
    return pg_catalog.jsonb_build_object('status', 'duplicate');
  end if;

  insert into public.public_collection_request_quotas (
    requester_hash,
    requested_date,
    request_count
  ) values (
    p_requester_hash,
    p_requested_date,
    0
  )
  on conflict (requester_hash, requested_date) do nothing;

  select q.request_count
  into v_request_count
  from public.public_collection_request_quotas q
  where q.requester_hash = p_requester_hash
    and q.requested_date = p_requested_date
  for update;

  if v_request_count >= 100 then
    return pg_catalog.jsonb_build_object('status', 'limit_reached');
  end if;

  update public.public_collection_request_quotas q
  set request_count = request_count + 1,
      updated_at = now()
  where q.requester_hash = p_requester_hash
    and q.requested_date = p_requested_date;

  if v_has_existing_request then
    update public.public_collection_requests r
    set status = 'pending',
        product_url = p_product_url,
        requested_at = now(),
        eligible_at = now(),
        collector_page_outcome = null,
        lease_until = null,
        attempt_count = 0,
        completed_at = null,
        updated_at = now()
    where r.request_id = v_existing_request.request_id;
  else
    insert into public.public_collection_requests (
      platform,
      external_shop_id,
      external_product_id,
      product_url
    ) values (
      'shopee',
      p_external_shop_id,
      p_external_product_id,
      p_product_url
    );
  end if;

  return pg_catalog.jsonb_build_object('status', 'queued');
end;
$$;

revoke all on function public.enqueue_public_collection_request(text,text,text,text,date) from public, anon, authenticated;
grant execute on function public.enqueue_public_collection_request(text,text,text,text,date) to service_role;
