-- Private, bounded diagnostic for one migrated product.
create function public.claim_admin_db2_single_check(p_skip_sold_out boolean)
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.product_database_directory
    where internal_product_id=142720 and database_id='db2' and not migration_in_progress)
    or not exists(select 1 from only public.collector_products where id=142720
      and last_checked_at < '2026-11-28 00:00:00+08')
    or now() >= '2026-11-30 00:00:00+08' then return null; end if;
  select to_jsonb(q) into result from public.claim_random_available_product_check_v2_rotation(
    array(select id from public.collector_products where id<>142720),p_skip_sold_out,null,'{}') q;
  if result is not null and (result->>'product_id')::bigint is distinct from 142720 then
    raise exception 'Unexpected single-check selection';
  end if;
  return result;
end $$;
revoke all on function public.claim_admin_db2_single_check(boolean) from public,anon,authenticated;
grant execute on function public.claim_admin_db2_single_check(boolean) to service_role;
