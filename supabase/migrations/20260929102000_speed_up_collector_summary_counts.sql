create index if not exists store_collection_requests_pending_eligible_count_idx
  on public.store_collection_requests (eligible_at)
  where status in ('pending', 'leased');

create index if not exists store_collection_requests_page_outcome_summary_idx
  on public.store_collection_requests (external_shop_id, external_product_id, updated_at desc)
  where collector_page_outcome in ('does_not_exist', 'unlisted', 'page_error');

create index if not exists public_collection_requests_page_outcome_summary_idx
  on public.public_collection_requests (external_shop_id, external_product_id, updated_at desc)
  where collector_page_outcome in ('does_not_exist', 'unlisted', 'page_error');

create index if not exists product_daily_checks_same_price_today_idx
  on public.product_daily_checks (checked_date, product_id)
  where status = 'success' and metadata ->> 'all_variations_unchanged' = 'true';
