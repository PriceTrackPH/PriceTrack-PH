create table public.collection_stores (
  store_id uuid primary key default gen_random_uuid(),
  platform text not null default 'shopee' check (platform = 'shopee'),
  store_key text not null unique,
  store_url text not null,
  display_name text not null,
  first_added_at timestamptz not null default now(),
  last_scan_id uuid,
  last_scan_started_at timestamptz,
  last_scan_finished_at timestamptz,
  last_scan_status text check (last_scan_status in ('completed', 'incomplete', 'failed')),
  last_discovered integer not null default 0 check (last_discovered >= 0),
  last_newly_queued integer not null default 0 check (last_newly_queued >= 0),
  last_duplicate integer not null default 0 check (last_duplicate >= 0),
  last_already_tracked integer not null default 0 check (last_already_tracked >= 0),
  updated_at timestamptz not null default now()
);

create table public.store_collection_requests (
  request_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.collection_stores(store_id) on delete cascade,
  platform text not null default 'shopee' check (platform = 'shopee'),
  external_shop_id text not null check (external_shop_id ~ '^[1-9][0-9]*$'),
  external_product_id text not null check (external_product_id ~ '^[1-9][0-9]*$'),
  product_url text not null,
  first_discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'leased', 'completed', 'removed')),
  lease_until timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (platform, external_shop_id, external_product_id)
);

create index store_collection_requests_fifo_idx
  on public.store_collection_requests (first_discovered_at, request_id)
  where status in ('pending', 'leased');

create index store_collection_requests_store_idx
  on public.store_collection_requests (store_id, last_seen_at desc);

alter table public.collection_stores enable row level security;
alter table public.store_collection_requests enable row level security;

revoke all on table public.collection_stores from public, anon, authenticated;
revoke all on table public.store_collection_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.collection_stores to service_role;
grant select, insert, update, delete on table public.store_collection_requests to service_role;

create or replace function public.begin_store_collection_scan(
  p_store_key text,
  p_store_url text,
  p_display_name text,
  p_scan_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  if p_scan_id is null
    or p_store_key is null or p_store_key !~ '^[a-z0-9._-]+$'
    or p_store_url is null or p_store_url = ''
    or p_display_name is null or p_display_name = '' then
    raise exception 'invalid store scan';
  end if;

  insert into public.collection_stores (
    store_key, store_url, display_name, last_scan_id, last_scan_started_at,
    last_scan_finished_at, last_scan_status, last_discovered,
    last_newly_queued, last_duplicate, last_already_tracked
  ) values (
    p_store_key, p_store_url, p_display_name, p_scan_id, now(),
    null, 'incomplete', 0, 0, 0, 0
  )
  on conflict (store_key) do update
  set store_url = excluded.store_url,
      display_name = excluded.display_name,
      last_scan_id = excluded.last_scan_id,
      last_scan_started_at = now(),
      last_scan_finished_at = null,
      last_scan_status = 'incomplete',
      last_discovered = 0,
      last_newly_queued = 0,
      last_duplicate = 0,
      last_already_tracked = 0,
      updated_at = now()
  returning store_id into v_store_id;

  return v_store_id;
end;
$$;

create or replace function public.import_store_collection_batch(
  p_scan_id uuid,
  p_products jsonb
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
  v_discovered integer := 0;
  v_newly_queued integer := 0;
  v_duplicate integer := 0;
  v_already_tracked integer := 0;
begin
  if p_scan_id is null or p_products is null or pg_catalog.jsonb_typeof(p_products) <> 'array'
    or pg_catalog.jsonb_array_length(p_products) > 5000 then
    raise exception 'invalid store batch';
  end if;

  select s.* into v_store
  from public.collection_stores s
  where s.last_scan_id = p_scan_id
  for update;
  if not found then raise exception 'unknown store scan'; end if;

  for v_product in select value from pg_catalog.jsonb_array_elements(p_products)
  loop
    v_shop_id := v_product ->> 'shopId';
    v_product_id := coalesce(v_product ->> 'externalProductId', v_product ->> 'productId');
    v_product_url := v_product ->> 'productUrl';
    if v_shop_id is null or v_shop_id !~ '^[1-9][0-9]*$'
      or v_product_id is null or v_product_id !~ '^[1-9][0-9]*$'
      or v_product_url is null or v_product_url = '' then
      raise exception 'invalid product identity';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('store:shopee:' || v_shop_id || ':' || v_product_id, 0)
    );
    v_discovered := v_discovered + 1;

    if exists (
      select 1 from public.products p
      where p.platform = 'shopee'
        and p.external_shop_id = v_shop_id
        and p.external_product_id = v_product_id
    ) then
      v_already_tracked := v_already_tracked + 1;
    elsif exists (
      select 1 from public.store_collection_requests r
      where r.platform = 'shopee'
        and r.external_shop_id = v_shop_id
        and r.external_product_id = v_product_id
    ) then
      insert into public.store_collection_requests (
        store_id, platform, external_shop_id, external_product_id, product_url
      ) values (
        v_store.store_id, 'shopee', v_shop_id, v_product_id, v_product_url
      )
      on conflict (platform, external_shop_id, external_product_id) do update
      set last_seen_at = now(), updated_at = now();
      v_duplicate := v_duplicate + 1;
    else
      insert into public.store_collection_requests (
        store_id, platform, external_shop_id, external_product_id, product_url
      ) values (
        v_store.store_id, 'shopee', v_shop_id, v_product_id, v_product_url
      );
      v_newly_queued := v_newly_queued + 1;
    end if;
  end loop;

  update public.collection_stores s
  set last_discovered = s.last_discovered + v_discovered,
      last_newly_queued = s.last_newly_queued + v_newly_queued,
      last_duplicate = s.last_duplicate + v_duplicate,
      last_already_tracked = s.last_already_tracked + v_already_tracked,
      updated_at = now()
  where s.store_id = v_store.store_id;

  return pg_catalog.jsonb_build_object(
    'discovered', v_discovered,
    'newlyQueued', v_newly_queued,
    'duplicate', v_duplicate,
    'alreadyTracked', v_already_tracked
  );
end;
$$;

create or replace function public.finish_store_collection_scan(
  p_scan_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.collection_stores%rowtype;
begin
  if p_status not in ('completed', 'incomplete', 'failed') then
    raise exception 'invalid scan status';
  end if;
  update public.collection_stores
  set last_scan_finished_at = now(), last_scan_status = p_status, updated_at = now()
  where last_scan_id = p_scan_id
  returning * into v_store;
  if not found then raise exception 'unknown store scan'; end if;
  return pg_catalog.jsonb_build_object(
    'storeId', v_store.store_id,
    'status', v_store.last_scan_status,
    'discovered', v_store.last_discovered,
    'newlyQueued', v_store.last_newly_queued,
    'duplicate', v_store.last_duplicate,
    'alreadyTracked', v_store.last_already_tracked
  );
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
  if p_lease_until is null or p_lease_until <= now() then raise exception 'lease must end in the future'; end if;
  update public.store_collection_requests
  set status = 'pending', lease_until = null, updated_at = now()
  where status = 'leased' and lease_until < now();

  return query
  with due as (
    select request_id
    from public.store_collection_requests
    where status = 'pending'
      and request_id <> all(coalesce(p_excluded_request_ids, '{}'::uuid[]))
    order by first_discovered_at asc, request_id asc
    limit 1
    for update skip locked
  ), leased as (
    update public.store_collection_requests r
    set status = 'leased', lease_until = p_lease_until,
        attempt_count = r.attempt_count + 1, updated_at = now()
    from due
    where r.request_id = due.request_id
    returning r.request_id, r.external_shop_id, r.external_product_id, r.product_url, r.lease_until
  )
  select leased.request_id, leased.external_shop_id, leased.external_product_id, leased.product_url, leased.lease_until
  from leased;
end;
$$;

create or replace function public.release_store_collection_request(
  p_request_id uuid,
  p_expected_lease_until timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.store_collection_requests r
  set status = 'pending', lease_until = null, updated_at = now()
  where r.request_id = p_request_id and r.status = 'leased'
    and r.lease_until = p_expected_lease_until;
end;
$$;

create or replace function public.complete_store_collection_request(
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
  update public.store_collection_requests r
  set status = 'completed', lease_until = null, completed_at = now(), updated_at = now()
  where r.platform = p_platform
    and r.external_shop_id = p_external_shop_id
    and r.external_product_id = p_external_product_id
    and r.status in ('pending', 'leased');
end;
$$;

create or replace function public.store_collection_queue_pending_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.store_collection_requests where status in ('pending', 'leased');
$$;

revoke all on function public.begin_store_collection_scan(text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.import_store_collection_batch(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.finish_store_collection_scan(uuid,text) from public, anon, authenticated;
revoke all on function public.claim_oldest_store_collection_request(uuid[],timestamptz) from public, anon, authenticated;
revoke all on function public.release_store_collection_request(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.complete_store_collection_request(text,text,text) from public, anon, authenticated;
revoke all on function public.store_collection_queue_pending_count() from public, anon, authenticated;

grant execute on function public.begin_store_collection_scan(text,text,text,uuid) to service_role;
grant execute on function public.import_store_collection_batch(uuid,jsonb) to service_role;
grant execute on function public.finish_store_collection_scan(uuid,text) to service_role;
grant execute on function public.claim_oldest_store_collection_request(uuid[],timestamptz) to service_role;
grant execute on function public.release_store_collection_request(uuid,timestamptz) to service_role;
grant execute on function public.complete_store_collection_request(text,text,text) to service_role;
grant execute on function public.store_collection_queue_pending_count() to service_role;
