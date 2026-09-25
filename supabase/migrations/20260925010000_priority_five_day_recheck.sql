-- Keep a requested product in the priority rotation. A successful check from
-- any source restarts its five-day clock; manual removals stay removed.
create or replace function public.complete_public_collection_request(
  p_platform text, p_external_shop_id text, p_external_product_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checked_at timestamptz;
begin
  select p.last_checked_at into v_checked_at
  from public.products p
  where p.platform = p_platform
    and p.external_shop_id = p_external_shop_id
    and p.external_product_id = p_external_product_id;

  update public.public_collection_requests r
  set status = 'completed',
      lease_until = null,
      completed_at = coalesce(v_checked_at, now()),
      eligible_at = coalesce(v_checked_at, now()) + interval '5 days',
      updated_at = now()
  where r.platform = p_platform
    and r.external_shop_id = p_external_shop_id
    and r.external_product_id = p_external_product_id
    and r.status <> 'removed'
    and (r.completed_at is null or r.completed_at < coalesce(v_checked_at, now()));
end;
$$;

-- Completed requests become claimable again once their five-day timer ends.
-- Oldest request wins among all due Priority Queue links.
create or replace function public.claim_oldest_public_collection_request(
  p_excluded_request_ids text[], p_lease_until timestamptz
)
returns table (
  request_id uuid, shop_id text, external_product_id text,
  product_url text, lease_until timestamptz
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
  set status = 'pending', lease_until = null, updated_at = now()
  where status = 'leased' and lease_until < now();

  return query
  with due as (
    select r.request_id
    from public.public_collection_requests r
    where r.status in ('pending', 'completed')
      and r.eligible_at <= now()
      and (r.lease_until is null or r.lease_until < now())
      and r.request_id::text <> all(coalesce(p_excluded_request_ids, '{}'::text[]))
    order by r.requested_at asc, r.request_id asc
    limit 1
    for update of r skip locked
  ), leased as (
    update public.public_collection_requests r
    set status = 'leased', lease_until = p_lease_until,
        attempt_count = r.attempt_count + 1, updated_at = now()
    from due
    where r.request_id = due.request_id
    returning r.request_id, r.external_shop_id, r.external_product_id,
              r.product_url, r.lease_until
  )
  select leased.request_id, leased.external_shop_id,
         leased.external_product_id, leased.product_url, leased.lease_until
  from leased;
end;
$$;

create or replace function public.public_collection_queue_pending_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.public_collection_requests
  where (status in ('pending', 'completed') and eligible_at <= now())
     or status = 'leased';
$$;

-- Previously completed links had no retry date; start their timer from the
-- recorded completion rather than making every historical link due at once.
update public.public_collection_requests r
set eligible_at = coalesce(r.completed_at, r.updated_at) + interval '5 days'
where r.status = 'completed'
  and r.eligible_at <= coalesce(r.completed_at, r.updated_at);

revoke all on function public.complete_public_collection_request(text,text,text)
  from public, anon, authenticated;
revoke all on function public.claim_oldest_public_collection_request(text[],timestamptz)
  from public, anon, authenticated;
revoke all on function public.public_collection_queue_pending_count()
  from public, anon, authenticated;
grant execute on function public.complete_public_collection_request(text,text,text)
  to service_role;
grant execute on function public.claim_oldest_public_collection_request(text[],timestamptz)
  to service_role;
grant execute on function public.public_collection_queue_pending_count()
  to service_role;
