alter table public.public_collection_requests
  add column if not exists one_time boolean not null default false;

-- Firefox recordings leave a single desktop enrichment job. Keep active leases
-- and the FIFO position of an already pending request intact.
create or replace function public.enqueue_firefox_collection_request(
  p_external_shop_id text, p_external_product_id text, p_product_url text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_external_shop_id !~ '^[0-9]+$' or p_external_product_id !~ '^[0-9]+$'
    or p_product_url is null or p_product_url = '' then
    raise exception 'invalid product identity';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'shopee:' || p_external_shop_id || ':' || p_external_product_id, 0));
  insert into public.public_collection_requests as r (
    platform, external_shop_id, external_product_id, product_url, one_time
  ) values ('shopee', p_external_shop_id, p_external_product_id, p_product_url, true)
  on conflict (platform, external_shop_id, external_product_id) do update set
    one_time = true,
    product_url = excluded.product_url,
    status = 'pending',
    requested_at = case when r.status = 'pending' then r.requested_at else now() end,
    eligible_at = case when r.status = 'pending' then r.eligible_at else now() end,
    completed_at = null, lease_until = null,
    attempt_count = case when r.status = 'pending' then r.attempt_count else 0 end,
    collector_page_outcome = null, updated_at = now()
  where r.status <> 'leased' or r.lease_until < now();
end;
$$;

create or replace function public.complete_public_collection_request(
  p_platform text, p_external_shop_id text, p_external_product_id text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_checked_at timestamptz;
begin
  select p.last_checked_at into v_checked_at from public.products p
  where p.platform=p_platform and p.external_shop_id=p_external_shop_id
    and p.external_product_id=p_external_product_id;
  update public.public_collection_requests r set
    status='completed', lease_until=null,
    completed_at=coalesce(v_checked_at,now()),
    eligible_at=case when r.one_time then 'infinity'::timestamptz
      else coalesce(v_checked_at,now())+interval '5 days' end,
    updated_at=now()
  where r.platform=p_platform and r.external_shop_id=p_external_shop_id
    and r.external_product_id=p_external_product_id and r.status<>'removed'
    and (not r.one_time or r.status='leased')
    and (r.completed_at is null or r.completed_at<coalesce(v_checked_at,now()));
end;
$$;

revoke all on function public.enqueue_firefox_collection_request(text,text,text) from public,anon,authenticated;
grant execute on function public.enqueue_firefox_collection_request(text,text,text) to service_role;
revoke all on function public.complete_public_collection_request(text,text,text) from public,anon,authenticated;
grant execute on function public.complete_public_collection_request(text,text,text) to service_role;
