-- Before recurring priority checks existed, normal checks did not update
-- completed priority requests. Use the newer successful product check so
-- existing links do not re-enter Priority Queue too early.
update public.public_collection_requests r
set completed_at = p.last_checked_at,
    eligible_at = p.last_checked_at + interval '5 days',
    updated_at = now()
from public.products p
where r.platform = p.platform
  and r.external_shop_id = p.external_shop_id
  and r.external_product_id = p.external_product_id
  and r.status = 'completed'
  and p.last_checked_at > r.completed_at;
