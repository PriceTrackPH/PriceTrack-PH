-- Prevent duplicate daily observations for the same variation state.
-- The collector already skips unchanged values during normal sequential requests.
-- This database constraint also protects against concurrent extension requests/races.

with ranked as (
  select
    id,
    row_number() over (
      partition by
        variation_id,
        observed_date,
        price,
        coalesce(original_price, -1),
        is_in_stock
      order by observed_at asc, id asc
    ) as rn
  from public.price_observations
)
delete from public.price_observations p
using ranked r
where p.id = r.id
  and r.rn > 1;

create unique index if not exists price_observations_daily_state_unique
on public.price_observations (
  variation_id,
  observed_date,
  price,
  (coalesce(original_price, -1)),
  is_in_stock
);
