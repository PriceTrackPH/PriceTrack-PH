alter table public.collection_stores
  add column if not exists last_sold_out integer not null default 0 check (last_sold_out >= 0),
  add column if not exists last_pages_current integer not null default 0 check (last_pages_current >= 0),
  add column if not exists last_pages_total integer not null default 0 check (last_pages_total >= 0);

update public.collection_stores
set last_scan_status = 'incomplete'
where last_scan_status = 'failed';

alter table public.collection_stores drop constraint if exists collection_stores_last_scan_status_check;
alter table public.collection_stores
  add constraint collection_stores_last_scan_status_check
  check (last_scan_status in ('completed', 'incomplete', 'interrupted'));

alter table public.store_collection_requests
  add column if not exists discovered_sold_out boolean not null default false,
  add column if not exists eligible_at timestamptz not null default now();

create index if not exists store_collection_requests_eligible_idx
  on public.store_collection_requests (eligible_at, first_discovered_at, request_id)
  where status in ('pending', 'leased');

create table public.store_scan_history (
  scan_id uuid primary key,
  store_id uuid not null references public.collection_stores(store_id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'incomplete'
    check (status in ('completed', 'incomplete', 'interrupted')),
  discovered integer not null default 0 check (discovered >= 0),
  newly_queued integer not null default 0 check (newly_queued >= 0),
  duplicate integer not null default 0 check (duplicate >= 0),
  already_tracked integer not null default 0 check (already_tracked >= 0),
  sold_out integer not null default 0 check (sold_out >= 0),
  pages_current integer not null default 0 check (pages_current >= 0),
  pages_total integer not null default 0 check (pages_total >= 0),
  check (pages_total = 0 or pages_current <= pages_total)
);

create index store_scan_history_started_idx
  on public.store_scan_history (started_at desc, scan_id desc);
create index store_scan_history_store_idx
  on public.store_scan_history (store_id, started_at desc);

create table public.store_scan_discoveries (
  scan_id uuid not null references public.store_scan_history(scan_id) on delete cascade,
  external_shop_id text not null check (external_shop_id ~ '^[1-9][0-9]*$'),
  external_product_id text not null check (external_product_id ~ '^[1-9][0-9]*$'),
  sold_out boolean not null default false,
  primary key (scan_id, external_shop_id, external_product_id)
);

alter table public.store_scan_history enable row level security;
alter table public.store_scan_discoveries enable row level security;
revoke all on table public.store_scan_history from public, anon, authenticated;
revoke all on table public.store_scan_discoveries from public, anon, authenticated;
grant select, insert, update, delete on table public.store_scan_history to service_role;
grant select, insert, update, delete on table public.store_scan_discoveries to service_role;

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
    last_newly_queued, last_duplicate, last_already_tracked,
    last_sold_out, last_pages_current, last_pages_total
  ) values (
    p_store_key, p_store_url, p_display_name, p_scan_id, now(),
    null, 'incomplete', 0, 0, 0, 0, 0, 0, 0
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
      last_sold_out = 0,
      last_pages_current = 0,
      last_pages_total = 0,
      updated_at = now()
  returning store_id into v_store_id;

  insert into public.store_scan_history (scan_id, store_id)
  values (p_scan_id, v_store_id);

  return v_store_id;
end;
$$;

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
            eligible_at = pg_catalog.greatest(eligible_at, now() + interval '15 days'),
            updated_at = now()
        where platform = 'shopee'
          and external_shop_id = v_shop_id
          and external_product_id = v_product_id
          and status = 'pending';
        update public.products
        set all_variations_sold_out = true,
            next_check_at = pg_catalog.greatest(coalesce(next_check_at, now()), now() + interval '15 days')
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
            next_check_at = pg_catalog.greatest(coalesce(next_check_at, now()), now() + interval '15 days')
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
              then pg_catalog.greatest(eligible_at, now() + interval '15 days')
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
      if not v_sold_out then
        v_newly_queued := v_newly_queued + 1;
      end if;
    end if;
  end loop;

  update public.store_scan_history h
  set discovered = h.discovered + v_discovered,
      newly_queued = h.newly_queued + v_newly_queued,
      duplicate = h.duplicate + v_duplicate,
      already_tracked = h.already_tracked + v_already_tracked,
      sold_out = h.sold_out + v_sold_out_count,
      pages_current = pg_catalog.greatest(h.pages_current, p_pages_current),
      pages_total = pg_catalog.greatest(h.pages_total, p_pages_total)
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

create or replace function public.finish_store_collection_scan(
  p_scan_id uuid,
  p_status text,
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
  v_history public.store_scan_history%rowtype;
begin
  if p_status not in ('completed', 'incomplete', 'interrupted')
    or p_pages_current is null or p_pages_current < 0
    or p_pages_total is null or p_pages_total < 0
    or (p_pages_total > 0 and p_pages_current > p_pages_total) then
    raise exception 'invalid scan status';
  end if;

  update public.store_scan_history
  set finished_at = now(),
      status = p_status,
      pages_current = pg_catalog.greatest(pages_current, p_pages_current),
      pages_total = pg_catalog.greatest(pages_total, p_pages_total)
  where scan_id = p_scan_id
  returning * into v_history;
  if not found then raise exception 'unknown store scan'; end if;

  update public.collection_stores
  set last_scan_finished_at = v_history.finished_at,
      last_scan_status = p_status,
      last_discovered = v_history.discovered,
      last_newly_queued = v_history.newly_queued,
      last_duplicate = v_history.duplicate,
      last_already_tracked = v_history.already_tracked,
      last_sold_out = v_history.sold_out,
      last_pages_current = v_history.pages_current,
      last_pages_total = v_history.pages_total,
      updated_at = now()
  where last_scan_id = p_scan_id
  returning * into v_store;
  if not found then raise exception 'unknown store scan'; end if;

  return pg_catalog.jsonb_build_object(
    'storeId', v_store.store_id,
    'status', v_history.status,
    'discovered', v_history.discovered,
    'newlyQueued', v_history.newly_queued,
    'duplicate', v_history.duplicate,
    'alreadyTracked', v_history.already_tracked,
    'soldOut', v_history.sold_out,
    'pagesCurrent', v_history.pages_current,
    'pagesTotal', v_history.pages_total
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
      and eligible_at <= now()
      and request_id <> all(coalesce(p_excluded_request_ids, '{}'::uuid[]))
    order by eligible_at asc, first_discovered_at asc, request_id asc
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

create or replace function public.store_collection_queue_pending_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from public.store_collection_requests
  where status in ('pending', 'leased')
    and eligible_at <= now();
$$;

-- Keep the previous production API compatible during the database/web rollout.
create or replace function public.import_store_collection_batch(p_scan_id uuid, p_products jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select public.import_store_collection_batch(p_scan_id, p_products, 0, 0);
$$;

create or replace function public.finish_store_collection_scan(p_scan_id uuid, p_status text)
returns jsonb language sql security definer set search_path = '' as $$
  select public.finish_store_collection_scan(
    p_scan_id,
    case when p_status = 'failed' then 'interrupted' else p_status end,
    0,
    0
  );
$$;

revoke all on function public.begin_store_collection_scan(text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.import_store_collection_batch(uuid,jsonb,integer,integer) from public, anon, authenticated;
revoke all on function public.finish_store_collection_scan(uuid,text,integer,integer) from public, anon, authenticated;
revoke all on function public.claim_oldest_store_collection_request(uuid[],timestamptz) from public, anon, authenticated;
revoke all on function public.store_collection_queue_pending_count() from public, anon, authenticated;
revoke all on function public.import_store_collection_batch(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.finish_store_collection_scan(uuid,text) from public, anon, authenticated;
grant execute on function public.begin_store_collection_scan(text,text,text,uuid) to service_role;
grant execute on function public.import_store_collection_batch(uuid,jsonb,integer,integer) to service_role;
grant execute on function public.finish_store_collection_scan(uuid,text,integer,integer) to service_role;
grant execute on function public.claim_oldest_store_collection_request(uuid[],timestamptz) to service_role;
grant execute on function public.store_collection_queue_pending_count() to service_role;
grant execute on function public.import_store_collection_batch(uuid,jsonb) to service_role;
grant execute on function public.finish_store_collection_scan(uuid,text) to service_role;
