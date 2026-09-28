-- Keep the existing RPC arguments for deployed extensions and Collector calls,
-- but stop persisting metrics removed from Normal Queue.
create or replace function public.record_product_activity(
  p_product_id bigint,
  p_observed_date date,
  p_observed_at timestamptz,
  p_client_hash text,
  p_is_admin_collector boolean,
  p_total_sold bigint,
  p_view_count bigint,
  p_review_count bigint,
  p_favorite_count bigint,
  p_rating numeric,
  p_discount_percent numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_product_id is null or p_observed_date is null or p_observed_at is null then
    raise exception 'invalid product activity';
  end if;

  update public.products
  set total_sold = coalesce(p_total_sold, total_sold),
      review_count = coalesce(p_review_count, review_count),
      favorite_count = coalesce(p_favorite_count, favorite_count),
      rating = case when p_rating between 0 and 5 then p_rating else rating end,
      activity_observed_at = p_observed_at
  where id = p_product_id;
end;
$$;

alter table public.products
  drop column shopee_view_count,
  drop column sales_activity_at,
  drop column estimated_daily_sales,
  drop column extension_visit_count_30d,
  drop column current_discount_percent;
