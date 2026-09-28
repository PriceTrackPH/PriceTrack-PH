-- Recover earliest known scan time for existing Store Queue requests.
-- Scan start is an approximation of the original insertion timestamp.
with first_scans as (
  select d.external_shop_id, d.external_product_id, min(h.started_at) as started_at
  from public.store_scan_discoveries d
  join public.store_scan_history h on h.scan_id = d.scan_id
  group by d.external_shop_id, d.external_product_id
)
update public.store_collection_requests r
set first_discovered_at = f.started_at
from first_scans f
where f.external_shop_id = r.external_shop_id
  and f.external_product_id = r.external_product_id
  and r.first_discovered_at > f.started_at;

-- Older requests with no surviving scan record retain a conservative date.
update public.store_collection_requests r
set first_discovered_at = least(r.last_seen_at, r.eligible_at)
where r.first_discovered_at > least(r.last_seen_at, r.eligible_at);
