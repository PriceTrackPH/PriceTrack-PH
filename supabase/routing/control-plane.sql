-- DB1 only. Private scheduling indexes; full product/history rows remain in
-- their owning database. Existing local tables are inherited, not copied.
-- Apply only with the directory migration and recorder routing in place.
do $$
declare base text; parent text; c record;
begin
  foreach base in array array['products','product_variations','product_daily_checks'] loop
    parent := 'collector_' || base;
    execute pg_catalog.format('create table public.%I (like public.%I)',parent,base);
    -- LIKE copies NOT NULL but not identity generation. Remote scheduling rows
    -- deliberately omit names, images, metadata, SKUs and all price history.
    for c in select attname from pg_catalog.pg_attribute
      where attrelid=pg_catalog.to_regclass('public.'||parent) and attnum>0 and not attisdropped
    loop
      execute pg_catalog.format('alter table public.%I alter column %I drop not null',parent,c.attname);
    end loop;
    execute pg_catalog.format('alter table public.%I add primary key(id)',parent);
    execute pg_catalog.format('alter table public.%I inherit public.%I',base,parent);
    execute pg_catalog.format('alter table public.%I enable row level security',parent);
    execute pg_catalog.format('revoke all on public.%I from public,anon,authenticated',parent);
    execute pg_catalog.format('grant select,insert,update,delete on public.%I to service_role',parent);
  end loop;
end $$;

alter table public.collector_products add constraint queue_entry_not_product
  check(name is null and shop_name is null and image_url is null and metadata is null and currency is null) no inherit;
alter table public.collector_product_variations add constraint queue_availability_not_variation
  check(id=-product_id and name is null and sku is null and external_variation_id is null and metadata is null) no inherit;
create unique index collector_product_identity on public.collector_products(platform,external_shop_id,external_product_id);
create index collector_product_due on public.collector_products(next_check_at);
create unique index collector_availability_product on public.collector_product_variations(product_id);
create unique index collector_daily_product_date on public.collector_product_daily_checks(product_id,checked_date);
create sequence public.collector_check_marker_id increment -1 minvalue -9223372036854775808 maxvalue -1 start -1;
alter table only public.collector_product_daily_checks alter column id set default nextval('public.collector_check_marker_id');
grant usage on sequence public.collector_check_marker_id to service_role;

-- Queue/favorite memberships belong to the central directory, not to a DB1
-- product row that is going to be removed during migration.
do $$
declare c record;
begin
  for c in select conname,conrelid::regclass as child from pg_catalog.pg_constraint
    where contype='f' and confrelid='public.products'::regclass
      and conrelid in ('public.personal_collection_products'::regclass,'public.collector_backlog_products'::regclass,'public.product_daily_extension_visits'::regclass)
  loop
    execute pg_catalog.format('alter table %s drop constraint %I',c.child,c.conname);
    execute pg_catalog.format('alter table %s add constraint %I foreign key(product_id) references public.product_database_directory(internal_product_id) on delete cascade',c.child,c.conname);
  end loop;
end $$;

-- Keep existing ordering, store rotation, sales windows, queue precedence,
-- eligibility, leases and batch logic. Only their central row source changes.
do $$
declare f record; ddl text;
begin
  for f in select oid,proname from pg_catalog.pg_proc
    where pronamespace='public'::regnamespace and prokind='f' and (
      proname like 'claim_%' or proname like 'collector_%' or proname in (
        'enqueue_public_collection_request','complete_public_collection_request',
        'store_collection_queue_pending_count','mark_collector_product_outcome',
        'reclaim_collector_product','import_store_collection_batch',
        'upsert_store_listing_metadata','keep_recorded_products_out_of_sq'))
  loop
    ddl := pg_catalog.pg_get_functiondef(f.oid);
    ddl := pg_catalog.replace(ddl,'public.products','public.collector_products');
    ddl := pg_catalog.replace(ddl,'public.product_variations','public.collector_product_variations');
    ddl := pg_catalog.replace(ddl,'public.product_daily_checks','public.collector_product_daily_checks');
    execute ddl;
  end loop;
end $$;

alter table public.product_database_directory add column last_queue_receipt_at timestamptz;

create function public.sync_owned_product_queue(p_database_id text,p_product jsonb,p_has_active_variations boolean,p_check jsonb default null)
returns void language plpgsql security invoker set search_path='' as $$
declare d public.product_database_directory%rowtype; state jsonb; col text; cols text; values_sql text;
  existing_attempt timestamptz; incoming_attempt timestamptz;
begin
  select * into d from public.product_database_directory where internal_product_id=(p_product->>'id')::bigint for update;
  if not found or d.database_id<>p_database_id or d.database_id='db1' or d.migration_in_progress
    or d.external_shop_id is distinct from p_product->>'external_shop_id'
    or d.external_product_id is distinct from p_product->>'external_product_id' then
    raise exception 'Invalid owned product queue receipt';
  end if;
  incoming_attempt := (p_product->>'last_check_attempt_at')::timestamptz;
  if d.last_queue_receipt_at is not null and (p_product->>'updated_at')::timestamptz<d.last_queue_receipt_at then return; end if;
  state := '{}'::jsonb;
  foreach col in array array['id','platform','external_shop_id','external_product_id','product_url',
    'is_active','first_seen_at','last_seen_at','created_at','updated_at','tracking_enabled',
    'next_check_at','last_check_attempt_at','last_checked_at','last_check_status','consecutive_check_failures',
    'all_variations_sold_out','stock_status_checked_at','consecutive_sold_out_checks','total_sold','review_count',
    'favorite_count','rating','price_drop_at','activity_observed_at','collector_page_outcome',
    'consecutive_unavailable_checks','consecutive_page_errors','shopee_sales_activity']
  loop
    if p_product ? col then state:=state||pg_catalog.jsonb_build_object(col,p_product->col); end if;
  end loop;
  state:=state||pg_catalog.jsonb_build_object('check_lease_until',null);
  update public.product_database_directory set last_queue_receipt_at=(p_product->>'updated_at')::timestamptz
    where internal_product_id=d.internal_product_id;
  select pg_catalog.string_agg(pg_catalog.format('%I',key),',') into cols from pg_catalog.jsonb_object_keys(state) key;
  select pg_catalog.string_agg(pg_catalog.format('%I=excluded.%I',key,key),',') into values_sql from pg_catalog.jsonb_object_keys(state) key where key<>'id';
  execute pg_catalog.format('insert into public.collector_products(%s) select %s from pg_catalog.jsonb_populate_record(null::public.collector_products,$1) on conflict(id) do update set %s',cols,cols,values_sql) using state;
  insert into public.collector_product_variations(id,product_id,is_active) values(-d.internal_product_id,d.internal_product_id,p_has_active_variations)
    on conflict(product_id) do update set is_active=excluded.is_active;
  if p_check is not null then
    insert into public.collector_product_daily_checks(product_id,checked_date,checked_at,source,status,variation_count,changed_count,unchanged_count,failed_count,metadata)
      values(d.internal_product_id,(p_check->>'checked_date')::date,(p_check->>'checked_at')::timestamptz,
        p_check->>'source',p_check->>'status',(p_check->>'variation_count')::integer,(p_check->>'changed_count')::integer,
        (p_check->>'unchanged_count')::integer,(p_check->>'failed_count')::integer,
        coalesce(p_check->'metadata','{}'::jsonb))
      on conflict(product_id,checked_date) do update set checked_at=greatest(collector_product_daily_checks.checked_at,excluded.checked_at),
        status=excluded.status,metadata=excluded.metadata,variation_count=excluded.variation_count,
        changed_count=excluded.changed_count,unchanged_count=excluded.unchanged_count,failed_count=excluded.failed_count;
  end if;
  -- A terminal page result must update central request eligibility too. These
  -- counters are the owner's recorded counters, not increments on a retry.
  if p_product->>'collector_page_outcome' in ('sold_out','does_not_exist','unlisted','page_error') then
    update public.public_collection_requests set
      status=case when (p_product->>'next_check_at')::timestamptz>now() then 'leased' else 'pending' end,
      lease_until=(p_product->>'next_check_at')::timestamptz,eligible_at=(p_product->>'next_check_at')::timestamptz,
      collector_page_outcome=p_product->>'collector_page_outcome',
      consecutive_sold_out_checks=coalesce((p_product->>'consecutive_sold_out_checks')::integer,0),
      consecutive_unavailable_checks=coalesce((p_product->>'consecutive_unavailable_checks')::integer,0),
      consecutive_page_errors=coalesce((p_product->>'consecutive_page_errors')::integer,0),updated_at=now()
      where platform=d.platform and external_shop_id=d.external_shop_id and external_product_id=d.external_product_id;
    update public.store_collection_requests set
      status=case when (p_product->>'next_check_at')::timestamptz>now() then 'leased' else 'pending' end,
      lease_until=(p_product->>'next_check_at')::timestamptz,eligible_at=(p_product->>'next_check_at')::timestamptz,
      collector_page_outcome=p_product->>'collector_page_outcome',
      consecutive_sold_out_checks=coalesce((p_product->>'consecutive_sold_out_checks')::integer,0),
      consecutive_unavailable_checks=coalesce((p_product->>'consecutive_unavailable_checks')::integer,0),
      consecutive_page_errors=coalesce((p_product->>'consecutive_page_errors')::integer,0),updated_at=now()
      where platform=d.platform and external_shop_id=d.external_shop_id and external_product_id=d.external_product_id;
  end if;
end $$;
revoke all on function public.sync_owned_product_queue(text,jsonb,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.sync_owned_product_queue(text,jsonb,boolean,jsonb) to service_role;

-- Freeze related writes as well as product upserts, including a recorder that
-- was already in flight when an operator began migration.
create function public.guard_primary_product_children()
returns trigger language plpgsql security invoker set search_path='' as $$
declare pid bigint; d public.product_database_directory%rowtype;
begin
  if tg_table_name='price_observations' then
    select product_id into pid from public.product_variations where id=new.variation_id;
  else pid:=new.product_id; end if;
  select * into d from public.product_database_directory where internal_product_id=pid for share;
  if not found then
    if exists(select 1 from public.site_settings where key='database_routing_live' and boolean_value) then raise exception 'Product ownership is missing'; end if;
  elsif d.database_id<>'db1' or d.migration_in_progress then raise exception 'Product history write belongs to another database or is being migrated'; end if;
  return new;
end $$;
revoke all on function public.guard_primary_product_children() from public,anon,authenticated;
create trigger guard_owned_variations before insert or update on public.product_variations for each row execute function public.guard_primary_product_children();
create trigger guard_owned_observations before insert or update on public.price_observations for each row execute function public.guard_primary_product_children();
create trigger guard_owned_daily_checks before insert or update on public.product_daily_checks for each row execute function public.guard_primary_product_children();

-- Scheduled capture failures need a central check marker even when no price
-- reached the owner. Successful price checks always come from owner receipts.
do $$
declare ddl text;
begin
  select pg_catalog.pg_get_functiondef(oid) into ddl from pg_catalog.pg_proc where pronamespace='public'::regnamespace and proname='mark_product_check';
  ddl:=pg_catalog.replace(ddl,'public.mark_product_check(','public.mark_remote_product_check(');
  ddl:=pg_catalog.replace(ddl,'product_daily_checks.','collector_product_daily_checks.');
  ddl:=pg_catalog.replace(ddl,'public.product_daily_checks','public.collector_product_daily_checks');
  ddl:=pg_catalog.replace(ddl,'public.products','public.collector_products');
  ddl:=pg_catalog.replace(ddl,'SET search_path TO ''public''','SET search_path TO ''''');
  execute ddl;
end $$;
revoke all on function public.mark_remote_product_check(bigint,date,timestamptz,text,text,integer,integer,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.mark_remote_product_check(bigint,date,timestamptz,text,text,integer,integer,integer,integer,jsonb) to service_role;

create function public.mark_collector_check(p_product_id bigint,p_checked_date date,p_checked_at timestamptz,p_source text,p_status text,p_variation_count integer,p_changed_count integer,p_unchanged_count integer,p_failed_count integer,p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare owner text;
begin
  select database_id into owner from public.product_database_directory where internal_product_id=p_product_id;
  if owner is null then raise exception 'Product ownership is missing'; end if;
  if owner='db1' then
    perform public.mark_product_check(p_product_id,p_checked_date,p_checked_at,p_source,p_status,p_variation_count,p_changed_count,p_unchanged_count,p_failed_count,p_metadata);
  else
    perform public.mark_remote_product_check(p_product_id,p_checked_date,p_checked_at,p_source,p_status,p_variation_count,p_changed_count,p_unchanged_count,p_failed_count,p_metadata);
  end if;
end $$;
revoke all on function public.mark_collector_check(bigint,date,timestamptz,text,text,integer,integer,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.mark_collector_check(bigint,date,timestamptz,text,text,integer,integer,integer,integer,jsonb) to service_role;
