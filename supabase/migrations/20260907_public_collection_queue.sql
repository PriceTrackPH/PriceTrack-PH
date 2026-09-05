create table public.public_collection_requests (
  request_id uuid primary key default gen_random_uuid(),
  platform text not null default 'shopee' check (platform = 'shopee'),
  external_shop_id text not null,
  external_product_id text not null,
  product_url text not null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'leased', 'completed', 'removed')),
  lease_until timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_shop_id, external_product_id)
);

create index public_collection_requests_fifo_idx
  on public.public_collection_requests (requested_at, request_id)
  where status in ('pending', 'leased');

create table public.public_collection_request_quotas (
  requester_hash text not null check (requester_hash ~ '^[0-9a-f]{64}$'),
  requested_date date not null,
  request_count integer not null default 0 check (request_count between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (requester_hash, requested_date)
);

alter table public.public_collection_requests enable row level security;
alter table public.public_collection_request_quotas enable row level security;

revoke all on table public.public_collection_requests from public, anon, authenticated;
revoke all on table public.public_collection_request_quotas from public, anon, authenticated;

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

create or replace function public.claim_oldest_public_collection_request(
  p_excluded_request_ids text[],
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

  update public.public_collection_requests
  set status = 'pending',
      lease_until = null,
      updated_at = now()
  where status = 'leased'
    and lease_until < now();

  return query
  with due as (
    select request_id
    from public.public_collection_requests
    where status = 'pending'
      and (lease_until is null or lease_until < now())
      and request_id::text <> all(coalesce(p_excluded_request_ids, '{}'::text[]))
    order by requested_at asc
    limit 1
    for update skip locked
  ), leased as (
    update public.public_collection_requests r
    set status = 'leased',
        lease_until = p_lease_until,
        attempt_count = r.attempt_count + 1,
        updated_at = now()
    from due
    where r.request_id = due.request_id
    returning
      r.request_id,
      r.external_shop_id,
      r.external_product_id,
      r.product_url,
      r.lease_until
  )
  select
    leased.request_id,
    leased.external_shop_id,
    leased.external_product_id,
    leased.product_url,
    leased.lease_until
  from leased;
end;
$$;

create or replace function public.release_public_collection_request(
  p_request_id uuid,
  p_expected_lease_until timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.public_collection_requests r
  set status = 'pending',
      lease_until = null,
      updated_at = now()
  where r.request_id = p_request_id
    and r.status = 'leased'
    and r.lease_until = p_expected_lease_until;
end;
$$;

create or replace function public.complete_public_collection_request(
  p_platform text,
  p_external_shop_id text,
  p_external_product_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.public_collection_requests r
  set status = 'completed',
      lease_until = null,
      completed_at = now(),
      updated_at = now()
  where r.platform = p_platform
    and r.external_shop_id = p_external_shop_id
    and r.external_product_id = p_external_product_id
    and r.status in ('pending', 'leased');
end;
$$;

create or replace function public.public_collection_queue_pending_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from public.public_collection_requests
  where status in ('pending', 'leased');
$$;

revoke all on function public.enqueue_public_collection_request(text,text,text,text,date) from public, anon, authenticated;
revoke all on function public.claim_oldest_public_collection_request(text[],timestamptz) from public, anon, authenticated;
revoke all on function public.release_public_collection_request(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.complete_public_collection_request(text,text,text) from public, anon, authenticated;
revoke all on function public.public_collection_queue_pending_count() from public, anon, authenticated;

grant execute on function public.enqueue_public_collection_request(text,text,text,text,date) to service_role;
grant execute on function public.claim_oldest_public_collection_request(text[],timestamptz) to service_role;
grant execute on function public.release_public_collection_request(uuid,timestamptz) to service_role;
grant execute on function public.complete_public_collection_request(text,text,text) to service_role;
grant execute on function public.public_collection_queue_pending_count() to service_role;
