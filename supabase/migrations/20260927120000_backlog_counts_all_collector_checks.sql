-- A new batch includes every currently available tracked Shopee product,
-- whether or not its normal next check is due. Completed products are
-- counted only when a check finishes during this batch.
create or replace function public.collector_backlog_begin()
returns table (backlog_id uuid, total bigint, remaining bigint, finished boolean)
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(21976271);
  select b.id into v_id from public.collector_backlogs b where b.finished_at is null limit 1;
  if v_id is null then
    insert into public.collector_backlogs default values returning id into v_id;
    insert into public.collector_backlog_products (backlog_id, product_id)
    select v_id, p.id from public.products p
    where p.platform = 'shopee' and p.is_active and p.tracking_enabled
      and p.all_variations_sold_out is distinct from true
      and exists (select 1 from public.product_variations v where v.product_id = p.id and v.is_active);
  end if;
  return query select b.id, count(bp.product_id),
    count(bp.product_id) filter (where bp.completed_at is null), false
  from public.collector_backlogs b
  left join public.collector_backlog_products bp on bp.backlog_id = b.id
  where b.id = v_id group by b.id;
end;
$$;

-- A completed collector check counts even if the backlog switch is Off.
-- A row already completed in this batch cannot be counted twice.
create or replace function public.collector_backlog_complete_active(
  p_shop_id text, p_external_product_id text, p_outcome text, p_backlog_id uuid
)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_remaining bigint;
begin
  select b.id into v_id from public.collector_backlogs b
  where b.finished_at is null limit 1 for update;
  if v_id is null then return null; end if;
  if p_backlog_id is not null and p_backlog_id <> v_id then return null; end if;
  update public.collector_backlog_products bp
    set completed_at = now(), outcome = p_outcome
  from public.products p
  where bp.product_id = p.id and bp.backlog_id = v_id
    and bp.completed_at is null and p.platform = 'shopee'
    and p.external_shop_id = p_shop_id and p.external_product_id = p_external_product_id;
  select count(*) into v_remaining from public.collector_backlog_products bp
    where bp.backlog_id = v_id and bp.completed_at is null;
  if v_remaining = 0 then
    update public.collector_backlogs b set finished_at = now() where b.id = v_id;
  end if;
  return v_remaining;
end;
$$;

revoke all on function public.collector_backlog_complete_active(text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.collector_backlog_complete_active(text,text,text,uuid) to service_role;
