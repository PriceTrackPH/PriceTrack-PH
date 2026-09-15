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
  if p_lease_until is null or p_lease_until <= now() then
    raise exception 'lease must end in the future';
  end if;

  update public.store_collection_requests
  set status = 'pending', lease_until = null, updated_at = now()
  where status = 'leased' and lease_until < now();

  return query
  with due as (
    select r.request_id
    from public.store_collection_requests r
    left join public.products p
      on p.platform = r.platform
     and p.external_shop_id = r.external_shop_id
     and p.external_product_id = r.external_product_id
    where r.status = 'pending'
      and r.eligible_at <= now()
      and (r.lease_until is null or r.lease_until < now())
      and r.request_id <> all(coalesce(p_excluded_request_ids, '{}'::uuid[]))
    order by
      case
        when coalesce(r.discovered_sold_out, false)
          or coalesce(p.all_variations_sold_out, false) then 2
        when coalesce(r.collector_page_outcome, p.collector_page_outcome)
          in ('does_not_exist', 'unlisted', 'page_error') then 1
        else 0
      end,
      coalesce(p.total_sold, r.total_sold) desc nulls last,
      case when coalesce(p.shopee_sales_activity, r.shopee_sales_activity) is null then 1 else 0 end,
      coalesce(p.review_count, r.listing_review_count) desc nulls last,
      case
        when coalesce(p.rating, r.listing_rating) is not null
          and coalesce(p.review_count, r.listing_review_count) is not null
          then coalesce(p.rating, r.listing_rating)
            * least(coalesce(p.review_count, r.listing_review_count), 1000)
        else coalesce(p.rating, r.listing_rating)
      end desc nulls last,
      r.first_discovered_at asc,
      r.request_id asc
    limit 1
    for update of r skip locked
  ), leased as (
    update public.store_collection_requests r
    set status = 'leased',
        lease_until = p_lease_until,
        attempt_count = r.attempt_count + 1,
        updated_at = now()
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

revoke all on function public.claim_oldest_store_collection_request(uuid[],timestamptz) from public, anon, authenticated;
grant execute on function public.claim_oldest_store_collection_request(uuid[],timestamptz) to service_role;
