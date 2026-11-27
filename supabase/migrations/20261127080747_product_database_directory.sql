-- Staged migration. Apply to DB1 only when all readers/collectors are routed.
create table public.product_databases (
  database_id text primary key check (database_id ~ '^db[1-9][0-9]{0,2}$'),
  accepts_new boolean not null default false,
  product_limit integer not null default 15000 check (product_limit between 1 and 15000),
  capacity_available boolean not null default false
);
-- Multiple configured destinations can be ready. The allocator fills them in
-- numeric order, closing a full destination without moving its existing data.

create table public.product_database_directory (
  platform text not null check (platform = 'shopee'),
  external_shop_id text not null check (external_shop_id ~ '^[0-9]{1,24}$'),
  external_product_id text not null check (external_product_id ~ '^[0-9]{1,24}$'),
  database_id text not null references public.product_databases(database_id),
  internal_product_id bigint unique,
  migration_in_progress boolean not null default false,
  assigned_at timestamptz not null default now(),
  primary key (platform,external_shop_id,external_product_id)
);
create index product_database_directory_owner on public.product_database_directory(database_id);
alter table public.product_databases enable row level security;
alter table public.product_database_directory enable row level security;
revoke all on public.product_databases, public.product_database_directory from public,anon,authenticated;
grant select,insert,update,delete on public.product_databases, public.product_database_directory to service_role;

insert into public.product_databases(database_id)
  values ('db1'),('db2'),('db3'),('db4'),('db5');
-- Backfill ownership; this does not copy or delete any product/history rows.
insert into public.product_database_directory(platform,external_shop_id,external_product_id,database_id,internal_product_id)
  select platform,external_shop_id,external_product_id,'db1',id
  from public.products where platform='shopee'
  on conflict (platform,external_shop_id,external_product_id) do nothing;

create function public.assign_product_database(p_platform text,p_shop_id text,p_product_id text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  assigned public.product_database_directory%rowtype;
  destination public.product_databases%rowtype;
  assigned_count bigint;
begin
  if p_platform is distinct from 'shopee' or p_shop_id is null or p_product_id is null
     or p_shop_id !~ '^[0-9]{1,24}$' or p_product_id !~ '^[0-9]{1,24}$' then
    raise exception 'Invalid product identity';
  end if;
  -- Serialize assignment and capacity checks. Never reassign an existing owner.
  perform pg_catalog.pg_advisory_xact_lock(873610209);
  select * into assigned from public.product_database_directory
    where platform=p_platform and external_shop_id=p_shop_id and external_product_id=p_product_id;
  if found then
    if assigned.migration_in_progress then raise exception 'Product migration in progress'; end if;
    return assigned.database_id;
  end if;
  -- A product written through an older path after the initial backfill is DB1's.
  if exists(select 1 from public.products where platform=p_platform
    and external_shop_id=p_shop_id and external_product_id=p_product_id) then
    insert into public.product_database_directory(platform,external_shop_id,external_product_id,database_id,internal_product_id)
      select p_platform,p_shop_id,p_product_id,'db1',id from public.products
      where platform=p_platform and external_shop_id=p_shop_id and external_product_id=p_product_id;
    return 'db1';
  end if;
  for destination in
    select * from public.product_databases where accepts_new and capacity_available
    order by pg_catalog.substring(database_id,3)::integer for update
  loop
    select count(*) into assigned_count from public.product_database_directory where database_id=destination.database_id;
    if assigned_count >= destination.product_limit then
      update public.product_databases set accepts_new=false where database_id=destination.database_id;
      continue;
    end if;
    insert into public.product_database_directory(platform,external_shop_id,external_product_id,database_id)
      values(p_platform,p_shop_id,p_product_id,destination.database_id);
    if assigned_count + 1 >= destination.product_limit then
      update public.product_databases set accepts_new=false where database_id=destination.database_id;
    end if;
    return destination.database_id;
  end loop;
  raise exception 'No database is accepting new products or database capacity reached';
end;
$$;
revoke all on function public.assign_product_database(text,text,text) from public,anon,authenticated;
grant execute on function public.assign_product_database(text,text,text) to service_role;

-- Legacy recorders must not recreate migrated identities in DB1. This guard is
-- part of the staged rollout, not a substitute for routing those recorders.
create function public.guard_primary_product_owner()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare assigned public.product_database_directory%rowtype;
begin
  if tg_op='UPDATE' and (old.id is distinct from new.id or old.platform is distinct from new.platform
    or old.external_shop_id is distinct from new.external_shop_id or old.external_product_id is distinct from new.external_product_id) then
    raise exception 'Product identity cannot change';
  end if;
  if new.platform <> 'shopee' then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(873610209);
  select * into assigned from public.product_database_directory
    where platform=new.platform and external_shop_id=new.external_shop_id and external_product_id=new.external_product_id;
  if not found then
    raise exception 'Product ownership must be assigned before a DB1 write';
  end if;
  if assigned.database_id <> 'db1' or assigned.migration_in_progress then
    raise exception 'Product belongs to another database or is being migrated';
  end if;
  insert into public.product_database_directory(platform,external_shop_id,external_product_id,database_id,internal_product_id)
    values(new.platform,new.external_shop_id,new.external_product_id,'db1',new.id)
    on conflict(platform,external_shop_id,external_product_id) do update
      set internal_product_id=excluded.internal_product_id;
  return new;
end;
$$;
revoke all on function public.guard_primary_product_owner() from public,anon,authenticated;
create trigger guard_primary_product_owner before insert or update on public.products
  for each row execute function public.guard_primary_product_owner();
