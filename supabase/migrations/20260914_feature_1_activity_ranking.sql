-- Feature 1: exact Shopee activity, unique extension visits, and smart normal-queue ordering.
alter table public.products
  add column if not exists total_sold bigint,
  add column if not exists review_count bigint,
  add column if not exists favorite_count bigint,
  add column if not exists rating numeric(4,3),
  add column if not exists current_discount_percent numeric(6,2),
  add column if not exists estimated_daily_sales numeric(14,3),
  add column if not exists sales_activity_at timestamptz,
  add column if not exists shopee_view_count bigint,
  add column if not exists price_drop_at timestamptz,
  add column if not exists activity_observed_at timestamptz,
  add column if not exists extension_visit_count_30d integer not null default 0;

create table if not exists public.product_daily_extension_visits (
  product_id bigint not null references public.products(id) on delete cascade,
  client_hash text not null check (client_hash ~ '^[0-9a-f]{64}$'),
  visited_date date not null,
  first_visited_at timestamptz not null,
  primary key (product_id, client_hash, visited_date)
);
create index if not exists product_daily_extension_visits_recent_idx
  on public.product_daily_extension_visits(product_id, visited_date desc);
alter table public.product_daily_extension_visits enable row level security;
revoke all on table public.product_daily_extension_visits from public, anon, authenticated;
grant select, insert, delete on table public.product_daily_extension_visits to service_role;

create or replace function public.record_product_activity(
  p_product_id bigint, p_observed_date date, p_observed_at timestamptz,
  p_client_hash text, p_is_admin_collector boolean,
  p_total_sold bigint, p_view_count bigint, p_review_count bigint, p_favorite_count bigint,
  p_rating numeric, p_discount_percent numeric
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_previous_sold bigint;
  v_previous_at timestamptz;
  v_days numeric;
begin
  if p_product_id is null or p_observed_date is null or p_observed_at is null then
    raise exception 'invalid product activity';
  end if;
  select total_sold, activity_observed_at into v_previous_sold, v_previous_at
  from public.products where id = p_product_id for update;

  if not coalesce(p_is_admin_collector, false) and p_client_hash ~ '^[0-9a-f]{64}$' then
    insert into public.product_daily_extension_visits(product_id, client_hash, visited_date, first_visited_at)
    values (p_product_id, p_client_hash, p_observed_date, p_observed_at)
    on conflict do nothing;
  end if;

  v_days := greatest(extract(epoch from (p_observed_at - v_previous_at)) / 86400.0, 1.0 / 24.0);
  update public.products set
    estimated_daily_sales = case
      when p_total_sold is not null and v_previous_sold is not null and p_total_sold >= v_previous_sold and v_previous_at is not null
        then (p_total_sold - v_previous_sold) / v_days
      else estimated_daily_sales end,
    sales_activity_at = case when p_total_sold is not null and v_previous_sold is not null and p_total_sold > v_previous_sold
      then p_observed_at else sales_activity_at end,
    total_sold = coalesce(p_total_sold, total_sold),
    shopee_view_count = coalesce(p_view_count, shopee_view_count),
    review_count = coalesce(p_review_count, review_count),
    favorite_count = coalesce(p_favorite_count, favorite_count),
    rating = case when p_rating between 0 and 5 then p_rating else rating end,
    current_discount_percent = case when p_discount_percent between 0 and 100 then p_discount_percent else current_discount_percent end,
    activity_observed_at = p_observed_at,
    extension_visit_count_30d = (select count(*) from public.product_daily_extension_visits v
      where v.product_id = p_product_id and v.visited_date >= p_observed_date - 29)
  where id = p_product_id;
end;
$$;

create or replace function public.claim_random_available_product_check(
  p_excluded_product_ids bigint[] default '{}'::bigint[], p_skip_sold_out boolean default true
) returns table(product_id bigint,shop_id text,external_product_id text,product_url text,lease_until timestamptz)
language plpgsql security definer set search_path='' as $$
begin return query with due as (
  select p.id from public.products p where p.platform='shopee' and p.is_active and p.tracking_enabled
    and (not coalesce(p_skip_sold_out,true) or coalesce(p.all_variations_sold_out,false)=false)
    and coalesce(p.next_check_at,now())<=now() and (p.check_lease_until is null or p.check_lease_until<now())
    and p.id<>all(coalesce(p_excluded_product_ids,'{}'::bigint[]))
    and not exists(select 1 from public.product_daily_checks c where c.product_id=p.id and c.checked_date=(now() at time zone 'Asia/Manila')::date and c.status='success')
  order by
    p.estimated_daily_sales desc nulls last,
    p.sales_activity_at desc nulls last,
    p.shopee_view_count desc nulls last,
    p.extension_visit_count_30d desc,
    p.last_checked_at desc nulls last,
    p.price_drop_at desc nulls last,
    p.current_discount_percent desc nulls last,
    p.total_sold desc nulls last,
    p.review_count desc nulls last,
    p.favorite_count desc nulls last,
    (coalesce(p.rating,0) * least(coalesce(p.review_count,0),1000)) desc,
    p.id
  limit 1 for update skip locked
), leased as (
  update public.products p set check_lease_until=now()+interval '10 minutes',last_check_attempt_at=now()
  from due where p.id=due.id returning p.id,p.external_shop_id,p.external_product_id,p.product_url,p.check_lease_until
) select leased.id,leased.external_shop_id,leased.external_product_id,leased.product_url,leased.check_lease_until from leased; end; $$;

revoke all on function public.record_product_activity(bigint,date,timestamptz,text,boolean,bigint,bigint,bigint,bigint,numeric,numeric) from public,anon,authenticated;
grant execute on function public.record_product_activity(bigint,date,timestamptz,text,boolean,bigint,bigint,bigint,bigint,numeric,numeric) to service_role;
revoke all on function public.claim_random_available_product_check(bigint[],boolean) from public,anon,authenticated;
grant execute on function public.claim_random_available_product_check(bigint[],boolean) to service_role;
