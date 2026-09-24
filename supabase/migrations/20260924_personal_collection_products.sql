create table public.personal_collection_products (
  product_id bigint primary key references public.products(id) on delete cascade,
  added_at timestamptz not null default now(),
  next_check_at timestamptz not null default now(),
  lease_until timestamptz
);
create index personal_collection_products_due_idx on public.personal_collection_products (next_check_at);
alter table public.personal_collection_products enable row level security;
revoke all on public.personal_collection_products from public, anon, authenticated;
grant select, insert, update, delete on public.personal_collection_products to service_role;

create function public.claim_personal_collection_product(
  p_excluded_product_ids bigint[],
  p_lease_until timestamptz,
  p_skip_sold_out boolean default true
)
returns table(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamptz)
language plpgsql security invoker set search_path = ''
as $$
declare v_id bigint;
begin
  select f.product_id into v_id
  from public.personal_collection_products f
  join public.products p on p.id = f.product_id
  where f.next_check_at <= now()
    and (f.lease_until is null or f.lease_until < now())
    and (p.check_lease_until is null or p.check_lease_until < now())
    and not (f.product_id = any(coalesce(p_excluded_product_ids, array[]::bigint[])))
    and (not p_skip_sold_out or p.all_variations_sold_out is distinct from true or p.next_check_at <= now())
  order by f.next_check_at, f.added_at
  for update of f, p skip locked
  limit 1;
  if v_id is null then return; end if;
  update public.personal_collection_products f set lease_until = p_lease_until where f.product_id = v_id;
  update public.products p set check_lease_until = p_lease_until where p.id = v_id;
  return query
    select p.id, p.external_shop_id, p.external_product_id, p.product_url, p_lease_until
    from public.products p where p.id = v_id;
end;
$$;
revoke all on function public.claim_personal_collection_product(bigint[],timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.claim_personal_collection_product(bigint[],timestamptz,boolean) to service_role;
