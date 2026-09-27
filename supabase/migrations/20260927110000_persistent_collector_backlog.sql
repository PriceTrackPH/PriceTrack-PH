-- A collector backlog is a fixed snapshot of due tracked products. A new backlog
-- starts only after the previous one has been finished; daily scheduling does not
-- add already completed products back to the active snapshot.
create table if not exists public.collector_backlogs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index if not exists collector_backlogs_single_active
  on public.collector_backlogs ((true)) where finished_at is null;

create table if not exists public.collector_backlog_products (
  backlog_id uuid not null references public.collector_backlogs(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete cascade,
  completed_at timestamptz,
  outcome text,
  primary key (backlog_id, product_id)
);

create index if not exists collector_backlog_products_pending
  on public.collector_backlog_products (backlog_id, product_id) where completed_at is null;

alter table public.collector_backlogs enable row level security;
alter table public.collector_backlog_products enable row level security;
revoke all on public.collector_backlogs, public.collector_backlog_products from public, anon, authenticated;
grant select, insert, update, delete on public.collector_backlogs, public.collector_backlog_products to service_role;

create or replace function public.collector_backlog_status()
returns table (backlog_id uuid, total bigint, remaining bigint, finished boolean)
language sql security invoker set search_path = '' as $$
  select b.id, count(bp.product_id), count(bp.product_id) filter (where bp.completed_at is null),
    b.finished_at is not null
  from public.collector_backlogs b
  left join public.collector_backlog_products bp on bp.backlog_id = b.id
  group by b.id
  order by b.created_at desc limit 1;
$$;

create or replace function public.collector_backlog_begin()
returns table (backlog_id uuid, total bigint, remaining bigint, finished boolean)
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  -- Serialize concurrent starts; no two browsers can build different active lists.
  perform pg_catalog.pg_advisory_xact_lock(21976271);
  select b.id into v_id from public.collector_backlogs b where b.finished_at is null limit 1;
  if v_id is null then
    insert into public.collector_backlogs default values returning id into v_id;
    insert into public.collector_backlog_products (backlog_id, product_id, completed_at, outcome)
    select v_id, p.id,
      case when c.product_id is not null then c.checked_at end,
      case when c.product_id is not null then 'checked' end
    from public.products p
    left join lateral (
      select d.product_id, d.checked_at from public.product_daily_checks d
      where d.product_id = p.id and d.checked_date = (now() at time zone 'Asia/Manila')::date
        and d.status = 'success' limit 1
    ) c on true
    where p.platform = 'shopee' and p.is_active and p.tracking_enabled
      and coalesce(p.next_check_at, now()) <= now()
      and exists (select 1 from public.product_variations v where v.product_id = p.id and v.is_active);
  end if;
  return query select b.id, count(bp.product_id),
    count(bp.product_id) filter (where bp.completed_at is null), false
  from public.collector_backlogs b
  left join public.collector_backlog_products bp on bp.backlog_id = b.id
  where b.id = v_id group by b.id;
end;
$$;

create or replace function public.collector_backlog_item_state(p_backlog_id uuid, p_shop_id text, p_external_product_id text)
returns text language sql security invoker set search_path = '' as $$
  select case when bp.completed_at is null then 'pending' else 'completed' end
  from public.collector_backlog_products bp
  join public.products p on p.id = bp.product_id
  where bp.backlog_id = p_backlog_id and p.platform = 'shopee'
    and p.external_shop_id = p_shop_id and p.external_product_id = p_external_product_id limit 1;
$$;

create or replace function public.collector_backlog_complete(
  p_backlog_id uuid, p_shop_id text, p_external_product_id text, p_outcome text
)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare v_remaining bigint;
begin
  update public.collector_backlog_products bp set completed_at = now(), outcome = p_outcome
  from public.products p where bp.product_id = p.id and bp.backlog_id = p_backlog_id
    and bp.completed_at is null and p.platform = 'shopee'
    and p.external_shop_id = p_shop_id and p.external_product_id = p_external_product_id;
  select count(*) into v_remaining from public.collector_backlog_products bp
    where bp.backlog_id = p_backlog_id and bp.completed_at is null;
  if v_remaining = 0 then
    update public.collector_backlogs b set finished_at = coalesce(b.finished_at, now()) where b.id = p_backlog_id;
  end if;
  return v_remaining;
end;
$$;

create or replace function public.claim_collector_backlog_product(
  p_backlog_id uuid, p_skip_sold_out boolean default true
)
returns table(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamptz)
language plpgsql security invoker set search_path = '' as $$
begin
  return query
  with due as (
    select p.id from public.collector_backlog_products bp
    join public.products p on p.id = bp.product_id
    where bp.backlog_id = p_backlog_id and bp.completed_at is null
      and p.is_active and p.tracking_enabled
      and (not p_skip_sold_out or p.all_variations_sold_out is distinct from true)
      and (p.check_lease_until is null or p.check_lease_until < now())
      and not exists (select 1 from public.product_daily_checks d
        where d.product_id = p.id and d.checked_date = (now() at time zone 'Asia/Manila')::date
          and d.status = 'success')
    order by p.estimated_daily_sales desc nulls last, p.sales_activity_at desc nulls last,
      p.shopee_view_count desc nulls last, p.last_checked_at desc nulls last,
      p.total_sold desc nulls last, p.id
    limit 1 for update of p skip locked
  ), leased as (
    update public.products p set check_lease_until = now() + interval '10 minutes',
      last_check_attempt_at = now() from due where p.id = due.id
    returning p.id, p.external_shop_id, p.external_product_id, p.product_url, p.check_lease_until
  )
  select leased.id, leased.external_shop_id, leased.external_product_id,
    leased.product_url, leased.check_lease_until from leased;
end;
$$;

revoke all on function public.collector_backlog_status(), public.collector_backlog_begin(),
  public.collector_backlog_item_state(uuid,text,text), public.collector_backlog_complete(uuid,text,text,text),
  public.claim_collector_backlog_product(uuid,boolean) from public, anon, authenticated;
grant execute on function public.collector_backlog_status(), public.collector_backlog_begin(),
  public.collector_backlog_item_state(uuid,text,text), public.collector_backlog_complete(uuid,text,text,text),
  public.claim_collector_backlog_product(uuid,boolean) to service_role;
