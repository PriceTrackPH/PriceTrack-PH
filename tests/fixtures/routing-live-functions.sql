CREATE OR REPLACE FUNCTION public.claim_collector_backlog_product(p_backlog_id uuid, p_skip_sold_out boolean DEFAULT true)
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  return query
  with due as (
    select p.id from public.collector_backlog_products bp
    join public.products p on p.id = bp.product_id
    where bp.backlog_id = p_backlog_id and bp.completed_at is null
      and p.is_active and p.tracking_enabled
      and (not p_skip_sold_out or p.all_variations_sold_out is distinct from true)
      and (p.check_lease_until is null or p.check_lease_until < now())
      and not exists (select 1 from public.product_daily_checks d
        where d.product_id = p.id and d.checked_date = (now() at time zone 'Asia/Manila')::date
          and d.status = 'success')
    order by p.total_sold desc nulls last,
      p.favorite_count desc nulls last,
      p.review_count desc nulls last,
      p.rating desc nulls last,
      coalesce(p.next_check_at, p.created_at),
      p.id
    limit 1 for update of p skip locked
  ), leased as (
    update public.products p set check_lease_until = now() + interval '10 minutes',
      last_check_attempt_at = now() from due where p.id = due.id
    returning p.id, p.external_shop_id, p.external_product_id, p.product_url, p.check_lease_until
  )
  select leased.id, leased.external_shop_id, leased.external_product_id,
    leased.product_url, leased.check_lease_until from leased;
end;
$function$;


CREATE OR REPLACE FUNCTION public.claim_collector_backlog_product_v2(p_backlog_id uuid, p_skip_sold_out boolean, p_skip_unchanged_day boolean)
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  return query
  with due as (
    select p.id from public.collector_backlog_products bp
    join public.products p on p.id = bp.product_id
    where bp.backlog_id = p_backlog_id and bp.completed_at is null
      and p.is_active and p.tracking_enabled
      and (not p_skip_sold_out or p.all_variations_sold_out is distinct from true)
      and (p.check_lease_until is null or p.check_lease_until < now())
      and not exists (select 1 from public.product_daily_checks d
        where d.product_id = p.id and d.checked_date = (now() at time zone 'Asia/Manila')::date
          and d.status = 'success')
      and (not p_skip_unchanged_day or p.next_check_at is null or p.next_check_at <= now()
        or not exists (select 1 from public.product_daily_checks previous
          where previous.product_id = p.id
            and previous.checked_date = (now() at time zone 'Asia/Manila')::date - 1
            and previous.status = 'success'
            and previous.metadata ->> 'skip_unchanged_day' = 'true'
            and previous.metadata ->> 'all_variations_unchanged' = 'true'))
    order by p.total_sold desc nulls last,
      p.favorite_count desc nulls last,
      p.review_count desc nulls last,
      p.rating desc nulls last,
      coalesce(p.next_check_at, p.created_at),
      p.id
    limit 1 for update of p skip locked
  ), leased as (
    update public.products p set check_lease_until = now() + interval '10 minutes',
      last_check_attempt_at = now() from due where p.id = due.id
    returning p.id, p.external_shop_id, p.external_product_id, p.product_url, p.check_lease_until
  )
  select leased.id, leased.external_shop_id, leased.external_product_id,
    leased.product_url, leased.check_lease_until from leased;
end;
$function$;


CREATE OR REPLACE FUNCTION public.claim_collector_backlog_product_v3(p_backlog_id uuid, p_skip_sold_out boolean, p_skip_unchanged_day boolean, p_last_shop_id text DEFAULT NULL::text)
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  return query
  with due as (
    select p.id from public.collector_backlog_products bp
    join public.products p on p.id = bp.product_id
    where bp.backlog_id = p_backlog_id and bp.completed_at is null
      and p.is_active and p.tracking_enabled
      and (not p_skip_sold_out or p.all_variations_sold_out is distinct from true)
      and (p.check_lease_until is null or p.check_lease_until < now())
      and not exists (select 1 from public.product_daily_checks d
        where d.product_id = p.id and d.checked_date = (now() at time zone 'Asia/Manila')::date
          and d.status = 'success')
      and (not p_skip_unchanged_day or p.next_check_at is null or p.next_check_at <= now()
        or not exists (select 1 from public.product_daily_checks previous
          where previous.product_id = p.id
            and previous.checked_date = (now() at time zone 'Asia/Manila')::date - 1
            and previous.status = 'success'
            and previous.metadata ->> 'skip_unchanged_day' = 'true'
            and previous.metadata ->> 'all_variations_unchanged' = 'true'))
    order by case
      when coalesce(p.all_variations_sold_out,false) then 2
      when p.collector_page_outcome in ('does_not_exist','unlisted','page_error') then 1
      else 0 end,
      p.total_sold desc nulls last,
      case when p.external_shop_id=p_last_shop_id then 1 else 0 end,
      p.favorite_count desc nulls last,
      p.review_count desc nulls last,
      p.rating desc nulls last,
      coalesce(p.next_check_at, p.created_at),
      p.id
    limit 1 for update of p skip locked
  ), leased as (
    update public.products p set check_lease_until = now() + interval '10 minutes',
      last_check_attempt_at = now() from due where p.id = due.id
    returning p.id, p.external_shop_id, p.external_product_id, p.product_url, p.check_lease_until
  )
  select leased.id, leased.external_shop_id, leased.external_product_id,
    leased.product_url, leased.check_lease_until from leased;
end;
$function$;


CREATE OR REPLACE FUNCTION public.claim_collector_backlog_product_v4(p_backlog_id uuid, p_skip_sold_out boolean, p_skip_unchanged_day boolean, p_last_shop_id text DEFAULT NULL::text, p_exclude_product_ids bigint[] DEFAULT ARRAY[]::bigint[])
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  return query
  with due as (
    select p.id from public.collector_backlog_products bp
    join public.products p on p.id = bp.product_id
    where bp.backlog_id = p_backlog_id and bp.completed_at is null
      and not (p.id = any(coalesce(p_exclude_product_ids, ARRAY[]::bigint[])))
      and p.is_active and p.tracking_enabled
      and (public.is_double_sale_day() or not p_skip_sold_out or p.all_variations_sold_out is distinct from true)
      and (p.check_lease_until is null or p.check_lease_until < now())
      and not exists (select 1 from public.product_daily_checks d
        where d.product_id = p.id and d.checked_date = (now() at time zone 'Asia/Manila')::date
          and d.status = 'success')
      and (
        public.is_double_sale_day()
        or not p_skip_unchanged_day or p.next_check_at is null or p.next_check_at <= now()
        or not exists (select 1 from public.product_daily_checks previous
          where previous.product_id = p.id
            and previous.checked_date = (now() at time zone 'Asia/Manila')::date - 1
            and previous.status = 'success'
            and previous.metadata ->> 'skip_unchanged_day' = 'true'
            and previous.metadata ->> 'all_variations_unchanged' = 'true')
      )
    order by case
      when coalesce(p.all_variations_sold_out,false) then 2
      when p.collector_page_outcome in ('does_not_exist','unlisted','page_error') then 1
      else 0 end,
      p.total_sold desc nulls last,
      case when p.external_shop_id=p_last_shop_id then 1 else 0 end,
      p.favorite_count desc nulls last,
      p.review_count desc nulls last,
      p.rating desc nulls last,
      coalesce(p.next_check_at, p.created_at),
      p.id
    limit 1 for update of p skip locked
  ), leased as (
    update public.products p set check_lease_until = now() + interval '10 minutes',
      last_check_attempt_at = now() from due where p.id = due.id
    returning p.id, p.external_shop_id, p.external_product_id, p.product_url, p.check_lease_until
  )
  select leased.id, leased.external_shop_id, leased.external_product_id,
    leased.product_url, leased.check_lease_until from leased;
end;
$function$;


CREATE OR REPLACE FUNCTION public.claim_collector_backlog_product_v4_rotation(p_backlog_id uuid, p_skip_sold_out boolean, p_skip_unchanged_day boolean, p_last_shop_id text DEFAULT NULL::text, p_exclude_product_ids bigint[] DEFAULT ARRAY[]::bigint[], p_excluded_shop_ids text[] DEFAULT '{}'::text[])
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  return query
  with due as (
    select p.id from public.collector_backlog_products bp
    join public.products p on p.id = bp.product_id
    where bp.backlog_id = p_backlog_id and bp.completed_at is null
      and not (p.id = any(coalesce(p_exclude_product_ids, ARRAY[]::bigint[])))
      and p.external_shop_id <> all(coalesce(p_excluded_shop_ids, '{}'::text[]))
      and p.is_active and p.tracking_enabled
      and (public.is_double_sale_day() or not p_skip_sold_out or p.all_variations_sold_out is distinct from true)
      and (p.check_lease_until is null or p.check_lease_until < now())
      and not exists (select 1 from public.product_daily_checks d
        where d.product_id = p.id and d.checked_date = (now() at time zone 'Asia/Manila')::date
          and d.status = 'success')
      and (
        public.is_double_sale_day()
        or not p_skip_unchanged_day or p.next_check_at is null or p.next_check_at <= now()
        or not exists (select 1 from public.product_daily_checks previous
          where previous.product_id = p.id
            and previous.checked_date = (now() at time zone 'Asia/Manila')::date - 1
            and previous.status = 'success'
            and previous.metadata ->> 'skip_unchanged_day' = 'true'
            and previous.metadata ->> 'all_variations_unchanged' = 'true')
      )
    order by case
      when coalesce(p.all_variations_sold_out,false) then 2
      when p.collector_page_outcome in ('does_not_exist','unlisted','page_error') then 1
      else 0 end,
      p.total_sold desc nulls last,
      case when p.external_shop_id=p_last_shop_id then 1 else 0 end,
      p.favorite_count desc nulls last,
      p.review_count desc nulls last,
      p.rating desc nulls last,
      coalesce(p.next_check_at, p.created_at),
      p.id
    limit 1 for update of p skip locked
  ), leased as (
    update public.products p set check_lease_until = now() + interval '10 minutes',
      last_check_attempt_at = now() from due where p.id = due.id
    returning p.id, p.external_shop_id, p.external_product_id, p.product_url, p.check_lease_until
  )
  select leased.id, leased.external_shop_id, leased.external_product_id,
    leased.product_url, leased.check_lease_until from leased;
end;
$function$;


CREATE OR REPLACE FUNCTION public.claim_due_product_checks(p_batch_size integer DEFAULT 10)
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with due as (
    select p.id
    from public.products p
    where p.platform = 'shopee'
      and p.is_active
      and p.tracking_enabled
      and coalesce(p.next_check_at, now()) <= now()
      and (p.check_lease_until is null or p.check_lease_until < now())
      and not exists (
        select 1
        from public.product_daily_checks c
        where c.product_id = p.id
          and c.checked_date = (now() at time zone 'Asia/Manila')::date
          and c.status = 'success'
      )
    order by p.next_check_at nulls first, p.id
    limit greatest(1, least(coalesce(p_batch_size, 10), 25))
    for update skip locked
  ), leased as (
    update public.products p
    set check_lease_until = now() + interval '10 minutes'
    from due
    where p.id = due.id
    returning p.id, p.external_shop_id, p.external_product_id, p.product_url
  )
  select leased.id, leased.external_shop_id, leased.external_product_id, leased.product_url
  from leased;
end;
$function$;


CREATE OR REPLACE FUNCTION public.claim_nq_cycle_product(p_mode text, p_excluded_product_ids bigint[] DEFAULT '{}'::bigint[], p_last_shop_id text DEFAULT NULL::text)
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_mode not in ('low','unavailable') then raise exception 'invalid NQ cycle mode'; end if;
  return query
  with candidate as (
    select p.id from public.products p
    where p.platform='shopee' and p.is_active and p.tracking_enabled
      and (p.check_lease_until is null or p.check_lease_until < now())
      and p.id <> all(coalesce(p_excluded_product_ids,'{}'::bigint[]))
      and not exists(select 1 from public.product_daily_checks c
        where c.product_id=p.id and c.checked_date=(now() at time zone 'Asia/Manila')::date and c.status='success')
      and (
        (p_mode='low' and coalesce(p.next_check_at,now())<=now()
          and not coalesce(p.all_variations_sold_out,false)
          and coalesce(p.collector_page_outcome,'') not in ('does_not_exist','unlisted','page_error')
          and exists(select 1 from public.product_variations v where v.product_id=p.id and v.is_active))
        or (p_mode='unavailable'
          and (coalesce(p.all_variations_sold_out,false) or p.collector_page_outcome in ('sold_out','does_not_exist','unlisted','page_error'))
          and (p.last_check_attempt_at is null or (p.last_check_attempt_at at time zone 'Asia/Manila')::date < (now() at time zone 'Asia/Manila')::date))
      )
    order by
      case when p_mode='unavailable' then random() end,
      p.total_sold asc nulls first,
      case when p.external_shop_id=p_last_shop_id then 1 else 0 end,
      p.favorite_count asc nulls first,p.review_count asc nulls first,p.rating asc nulls first,
      coalesce(p.next_check_at,p.created_at) desc,p.id desc
    limit 1 for update skip locked
  ), leased as (
    update public.products p set check_lease_until=now()+interval '10 minutes',last_check_attempt_at=now()
    from candidate c where p.id=c.id
    returning p.id,p.external_shop_id,p.external_product_id,p.product_url,p.check_lease_until
  )
  select l.id,l.external_shop_id,l.external_product_id,l.product_url,l.check_lease_until from leased l;
end;
$function$;


CREATE OR REPLACE FUNCTION public.claim_nq_cycle_product_rotation(p_mode text, p_excluded_product_ids bigint[] DEFAULT '{}'::bigint[], p_last_shop_id text DEFAULT NULL::text, p_excluded_shop_ids text[] DEFAULT '{}'::text[])
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_mode not in ('low','unavailable') then raise exception 'invalid NQ cycle mode'; end if;
  return query
  with candidate as (
    select p.id from public.products p
    where p.platform='shopee' and p.external_shop_id <> all(coalesce(p_excluded_shop_ids, '{}'::text[])) and p.is_active and p.tracking_enabled
      and (p.check_lease_until is null or p.check_lease_until < now())
      and p.id <> all(coalesce(p_excluded_product_ids,'{}'::bigint[]))
      and not exists(select 1 from public.product_daily_checks c
        where c.product_id=p.id and c.checked_date=(now() at time zone 'Asia/Manila')::date and c.status='success')
      and (
        (p_mode='low' and coalesce(p.next_check_at,now())<=now()
          and not coalesce(p.all_variations_sold_out,false)
          and coalesce(p.collector_page_outcome,'') not in ('does_not_exist','unlisted','page_error')
          and exists(select 1 from public.product_variations v where v.product_id=p.id and v.is_active))
        or (p_mode='unavailable'
          and (coalesce(p.all_variations_sold_out,false) or p.collector_page_outcome in ('sold_out','does_not_exist','unlisted','page_error'))
          and (p.last_check_attempt_at is null or (p.last_check_attempt_at at time zone 'Asia/Manila')::date < (now() at time zone 'Asia/Manila')::date))
      )
    order by
      case when p_mode='unavailable' then random() end,
      p.total_sold asc nulls first,
      case when p.external_shop_id=p_last_shop_id then 1 else 0 end,
      p.favorite_count asc nulls first,p.review_count asc nulls first,p.rating asc nulls first,
      coalesce(p.next_check_at,p.created_at) desc,p.id desc
    limit 1 for update skip locked
  ), leased as (
    update public.products p set check_lease_until=now()+interval '10 minutes',last_check_attempt_at=now()
    from candidate c where p.id=c.id
    returning p.id,p.external_shop_id,p.external_product_id,p.product_url,p.check_lease_until
  )
  select l.id,l.external_shop_id,l.external_product_id,l.product_url,l.check_lease_until from leased l;
end;
$function$;


CREATE OR REPLACE FUNCTION public.claim_oldest_public_collection_request(p_excluded_request_ids text[], p_lease_until timestamp with time zone)
 RETURNS TABLE(request_id uuid, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;


CREATE OR REPLACE FUNCTION public.claim_oldest_store_collection_request(p_excluded_request_ids uuid[], p_lease_until timestamp with time zone)
 RETURNS TABLE(request_id uuid, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_sold_out_turn boolean;
  v_last_shop_id text;
  v_cycle_shops text[];
begin
  if p_lease_until is null or p_lease_until <= now() then
    raise exception 'lease must end in the future';
  end if;

  with expired as (
    select r.request_id
    from public.store_collection_requests r
    where r.status = 'leased' and r.lease_until < now()
    for update skip locked
  )
  update public.store_collection_requests r
  set status = 'pending', lease_until = null, updated_at = now()
  from expired
  where r.request_id = expired.request_id;

  -- Serialize claims so the 25:1 cadence survives page reloads and runs.
  select available_since_sold_out >= 25, last_shop_id, cycle_shop_ids
    into v_sold_out_turn, v_last_shop_id, v_cycle_shops
  from public.store_queue_selection_state where id = 1 for update;

  return query
  with due as (
    select r.request_id,
      (coalesce(r.discovered_sold_out, false) or coalesce(p.all_variations_sold_out, false)) as is_sold_out
    from public.store_collection_requests r
    left join public.products p
      on p.platform = r.platform
     and p.external_shop_id = r.external_shop_id
     and p.external_product_id = r.external_product_id
    where r.status = 'pending'
      and p.id is null
      and r.eligible_at <= now()
      and (r.lease_until is null or r.lease_until < now())
      and r.request_id <> all(coalesce(p_excluded_request_ids, '{}'::uuid[]))
    order by
      case when v_sold_out_turn
        then case when coalesce(r.discovered_sold_out, false) or coalesce(p.all_variations_sold_out, false) then 0 else 1 end
        else case when coalesce(r.discovered_sold_out, false) or coalesce(p.all_variations_sold_out, false) then 1 else 0 end
      end,
      case
        when coalesce(r.discovered_sold_out, false)
          or coalesce(p.all_variations_sold_out, false) then 2
        when coalesce(r.collector_page_outcome, p.collector_page_outcome)
          in ('does_not_exist', 'unlisted', 'page_error') then 1
        else 0
      end,
      case when not v_sold_out_turn and r.external_shop_id = any(v_cycle_shops) then 1 else 0 end,
      case when r.external_shop_id = v_last_shop_id then 1 else 0 end,
      pg_catalog.random()
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
  ), counted as (
    update public.store_queue_selection_state state
    set available_since_sold_out = case
          when due.is_sold_out then 0
          when v_sold_out_turn then 1
          else least(25, state.available_since_sold_out + 1)
        end,
        cycle_shop_ids = case
          when due.is_sold_out then '{}'::text[]
          when v_sold_out_turn then array[leased.external_shop_id]
          when leased.external_shop_id = any(state.cycle_shop_ids) then state.cycle_shop_ids
          else pg_catalog.array_append(state.cycle_shop_ids, leased.external_shop_id)
        end,
        last_shop_id = leased.external_shop_id
    from due, leased
    where state.id = 1 and due.request_id = leased.request_id
    returning state.id
  )
  select leased.request_id, leased.external_shop_id,
         leased.external_product_id, leased.product_url, leased.lease_until
  from leased join counted on true;
end;
$function$;


CREATE OR REPLACE FUNCTION public.claim_personal_collection_product(p_excluded_product_ids bigint[], p_lease_until timestamp with time zone, p_skip_sold_out boolean DEFAULT true)
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;


CREATE OR REPLACE FUNCTION public.claim_personal_collection_product_v2(p_excluded_product_ids bigint[], p_lease_until timestamp with time zone, p_skip_sold_out boolean, p_last_shop_id text)
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_id bigint;
begin
  select f.product_id into v_id
  from public.personal_collection_products f
  join public.products p on p.id = f.product_id
  where f.next_check_at <= now()
    and (f.lease_until is null or f.lease_until < now())
    and (p.check_lease_until is null or p.check_lease_until < now())
    and not (f.product_id = any(coalesce(p_excluded_product_ids, array[]::bigint[])))
    and (p_last_shop_id is null or p.external_shop_id <> p_last_shop_id)
    and (not p_skip_sold_out or p.all_variations_sold_out is distinct from true or p.next_check_at <= now())
  order by pg_catalog.random()
  for update of f, p skip locked
  limit 1;
  if v_id is null then return; end if;
  update public.personal_collection_products f set lease_until = p_lease_until where f.product_id = v_id;
  update public.products p set check_lease_until = p_lease_until where p.id = v_id;
  return query
    select p.id, p.external_shop_id, p.external_product_id, p.product_url, p_lease_until
    from public.products p where p.id = v_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.claim_random_available_product_check(p_excluded_product_ids bigint[] DEFAULT '{}'::bigint[])
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with due as (
    select p.id
    from public.products p
    where p.platform = 'shopee'
      and p.is_active
      and p.tracking_enabled
      and coalesce(p.all_variations_sold_out, false) = false
      and exists (
        select 1
        from public.product_variations v
        where v.product_id = p.id
          and v.is_active
      )
      and coalesce(p.next_check_at, now()) <= now()
      and (p.check_lease_until is null or p.check_lease_until < now())
      and p.id <> all(coalesce(p_excluded_product_ids, '{}'::bigint[]))
      and not exists (
        select 1
        from public.product_daily_checks c
        where c.product_id = p.id
          and c.checked_date = (now() at time zone 'Asia/Manila')::date
          and c.status = 'success'
      )
    order by p.total_sold desc nulls last,
      p.favorite_count desc nulls last,
      p.review_count desc nulls last,
      p.rating desc nulls last,
      coalesce(p.next_check_at, p.created_at),
      p.id
    limit 1
    for update skip locked
  ), leased as (
    update public.products p
    set check_lease_until = now() + interval '10 minutes',
        last_check_attempt_at = now()
    from due
    where p.id = due.id
    returning p.id, p.external_shop_id, p.external_product_id, p.product_url, p.check_lease_until
  )
  select leased.id, leased.external_shop_id, leased.external_product_id, leased.product_url, leased.check_lease_until
  from leased;
end;
$function$;


CREATE OR REPLACE FUNCTION public.claim_random_available_product_check(p_excluded_product_ids bigint[] DEFAULT '{}'::bigint[], p_skip_sold_out boolean DEFAULT true)
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return query
  with due as (
    select p.id
    from public.products p
    where p.platform = 'shopee'
      and p.is_active
      and p.tracking_enabled
      and (
        not coalesce(p_skip_sold_out, true)
        or coalesce(p.all_variations_sold_out, false) = false
      )
      and coalesce(p.next_check_at, now()) <= now()
      and (p.check_lease_until is null or p.check_lease_until < now())
      and p.id <> all(coalesce(p_excluded_product_ids, '{}'::bigint[]))
      and not exists (
        select 1 from public.product_daily_checks c
        where c.product_id = p.id
          and c.checked_date = (now() at time zone 'Asia/Manila')::date
          and c.status = 'success'
      )
    order by
      case
        when coalesce(p.all_variations_sold_out, false) then 2
        when p.collector_page_outcome in ('does_not_exist', 'unlisted', 'page_error') then 1
        else 0
      end,
      p.total_sold desc nulls last,
      p.favorite_count desc nulls last,
      p.review_count desc nulls last,
      p.rating desc nulls last,
      coalesce(p.next_check_at, p.created_at),
      p.id
    limit 1
    for update skip locked
  ), leased as (
    update public.products p
    set check_lease_until = now() + interval '10 minutes',
        last_check_attempt_at = now()
    from due
    where p.id = due.id
    returning p.id, p.external_shop_id, p.external_product_id,
              p.product_url, p.check_lease_until
  )
  select leased.id, leased.external_shop_id, leased.external_product_id,
         leased.product_url, leased.check_lease_until
  from leased;
end;
$function$;


CREATE OR REPLACE FUNCTION public.claim_random_available_product_check_v2(p_excluded_product_ids bigint[] DEFAULT '{}'::bigint[], p_skip_sold_out boolean DEFAULT true, p_last_shop_id text DEFAULT NULL::text)
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return query
  with due as (
    select p.id
    from public.products p
    where p.platform = 'shopee'
      and p.is_active
      and p.tracking_enabled
      and (
        public.is_double_sale_day()
        or not coalesce(p_skip_sold_out, true)
        or coalesce(p.all_variations_sold_out, false) = false
      )
      and (
        public.is_double_sale_day()
        or coalesce(p.next_check_at, now()) <= now()
      )
      and (p.check_lease_until is null or p.check_lease_until < now())
      and p.id <> all(coalesce(p_excluded_product_ids, '{}'::bigint[]))
      and not exists (
        select 1 from public.product_daily_checks c
        where c.product_id = p.id
          and c.checked_date = (now() at time zone 'Asia/Manila')::date
          and c.status = 'success'
      )
    order by
      case
        when coalesce(p.all_variations_sold_out, false) then 2
        when p.collector_page_outcome in ('does_not_exist', 'unlisted', 'page_error') then 1
        else 0
      end,
      p.total_sold desc nulls last,
      case when p.external_shop_id = p_last_shop_id then 1 else 0 end,
      p.favorite_count desc nulls last,
      p.review_count desc nulls last,
      p.rating desc nulls last,
      coalesce(p.next_check_at, p.created_at),
      p.id
    limit 1
    for update skip locked
  ), leased as (
    update public.products p
    set check_lease_until = now() + interval '10 minutes',
        last_check_attempt_at = now()
    from due
    where p.id = due.id
    returning p.id, p.external_shop_id, p.external_product_id,
              p.product_url, p.check_lease_until
  )
  select leased.id, leased.external_shop_id, leased.external_product_id,
         leased.product_url, leased.check_lease_until
  from leased;
end;
$function$;


CREATE OR REPLACE FUNCTION public.claim_random_available_product_check_v2_rotation(p_excluded_product_ids bigint[] DEFAULT '{}'::bigint[], p_skip_sold_out boolean DEFAULT true, p_last_shop_id text DEFAULT NULL::text, p_excluded_shop_ids text[] DEFAULT '{}'::text[])
 RETURNS TABLE(product_id bigint, shop_id text, external_product_id text, product_url text, lease_until timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return query
  with due as (
    select p.id
    from public.products p
    where p.platform = 'shopee'
      and p.external_shop_id <> all(coalesce(p_excluded_shop_ids, '{}'::text[]))
      and p.is_active
      and p.tracking_enabled
      and (
        public.is_double_sale_day()
        or not coalesce(p_skip_sold_out, true)
        or coalesce(p.all_variations_sold_out, false) = false
      )
      and (
        public.is_double_sale_day()
        or coalesce(p.next_check_at, now()) <= now()
      )
      and (p.check_lease_until is null or p.check_lease_until < now())
      and p.id <> all(coalesce(p_excluded_product_ids, '{}'::bigint[]))
      and not exists (
        select 1 from public.product_daily_checks c
        where c.product_id = p.id
          and c.checked_date = (now() at time zone 'Asia/Manila')::date
          and c.status = 'success'
      )
    order by
      case
        when coalesce(p.all_variations_sold_out, false) then 2
        when p.collector_page_outcome in ('does_not_exist', 'unlisted', 'page_error') then 1
        else 0
      end,
      p.total_sold desc nulls last,
      case when p.external_shop_id = p_last_shop_id then 1 else 0 end,
      p.favorite_count desc nulls last,
      p.review_count desc nulls last,
      p.rating desc nulls last,
      coalesce(p.next_check_at, p.created_at),
      p.id
    limit 1
    for update skip locked
  ), leased as (
    update public.products p
    set check_lease_until = now() + interval '10 minutes',
        last_check_attempt_at = now()
    from due
    where p.id = due.id
    returning p.id, p.external_shop_id, p.external_product_id,
              p.product_url, p.check_lease_until
  )
  select leased.id, leased.external_shop_id, leased.external_product_id,
         leased.product_url, leased.check_lease_until
  from leased;
end;
$function$;


CREATE OR REPLACE FUNCTION public.collector_available_summary()
 RETURNS TABLE(total_tracked bigint, total_due bigint, sold_out_deferred bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    count(*) filter (
      where p.platform = 'shopee' and p.is_active and p.tracking_enabled
    ) as total_tracked,
    count(*) filter (
      where p.platform = 'shopee'
        and p.is_active
        and p.tracking_enabled
        and coalesce(p.next_check_at, now()) <= now()
        and exists (
          select 1
          from public.product_variations v
          where v.product_id = p.id
            and v.is_active
        )
    ) as total_due,
    count(*) filter (
      where p.platform = 'shopee'
        and p.is_active
        and p.tracking_enabled
        and not exists (
          select 1
          from public.product_variations v
          where v.product_id = p.id
            and v.is_active
        )
    ) as sold_out_deferred
  from public.products p;
$function$;


CREATE OR REPLACE FUNCTION public.collector_available_summary_v2()
 RETURNS TABLE(total_tracked bigint, total_due bigint, sold_out_deferred bigint, same_price_deferred bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    count(*) filter (
      where p.platform = 'shopee' and p.is_active and p.tracking_enabled
    ) as total_tracked,
    count(*) filter (
      where p.platform = 'shopee'
        and p.is_active
        and p.tracking_enabled
        and coalesce(p.next_check_at, now()) <= now()
        and exists (
          select 1 from public.product_variations v
          where v.product_id = p.id and v.is_active
        )
    ) as total_due,
    count(*) filter (
      where p.platform = 'shopee'
        and p.is_active
        and p.tracking_enabled
        and not exists (
          select 1 from public.product_variations v
          where v.product_id = p.id and v.is_active
        )
    ) as sold_out_deferred,
    (
      select count(*)
      from public.product_daily_checks c
      join public.products checked_product on checked_product.id = c.product_id
      where c.checked_date = (now() at time zone 'Asia/Manila')::date
        and c.status = 'success'
        and c.metadata ->> 'all_variations_unchanged' = 'true'
        and checked_product.platform = 'shopee'
        and checked_product.is_active
        and checked_product.tracking_enabled
    ) as same_price_deferred
  from public.products p;
$function$;


CREATE OR REPLACE FUNCTION public.collector_available_summary_v3()
 RETURNS TABLE(total_tracked bigint, total_due bigint, sold_out_deferred bigint, same_price_deferred bigint, does_not_exist_count bigint, unlisted_count bigint, page_error_count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with tracked as (
    select
      count(*) filter (where p.platform = 'shopee' and p.is_active and p.tracking_enabled) as total_tracked,
      count(*) filter (
        where p.platform = 'shopee' and p.is_active and p.tracking_enabled
          and coalesce(p.next_check_at, now()) <= now()
          and exists (select 1 from public.product_variations v where v.product_id = p.id and v.is_active)
          and not exists (
            select 1 from public.product_daily_checks c
            where c.product_id = p.id
              and c.checked_date = (now() at time zone 'Asia/Manila')::date
              and c.status = 'success'
          )
      ) as total_due,
      count(*) filter (
        where p.platform = 'shopee' and p.is_active and p.tracking_enabled
          and p.collector_page_outcome is distinct from 'does_not_exist'
          and p.collector_page_outcome is distinct from 'unlisted'
          and p.collector_page_outcome is distinct from 'page_error'
          and not exists (select 1 from public.product_variations v where v.product_id = p.id and v.is_active)
      ) as sold_out_deferred,
      count(*) filter (
        where p.platform = 'shopee' and p.is_active and p.tracking_enabled
          and p.collector_page_outcome = 'does_not_exist'
      ) as does_not_exist_count,
      count(*) filter (
        where p.platform = 'shopee' and p.is_active and p.tracking_enabled
          and p.collector_page_outcome = 'unlisted'
      ) as unlisted_count,
      count(*) filter (
        where p.platform = 'shopee' and p.is_active and p.tracking_enabled
          and p.collector_page_outcome = 'page_error'
      ) as page_error_count
    from public.products p
  ), queue_outcomes as (
    select distinct on (q.shop_id, q.product_id)
      q.shop_id, q.product_id, q.outcome
    from (
      select r.external_shop_id as shop_id, r.external_product_id as product_id,
        r.collector_page_outcome as outcome, r.updated_at
      from public.public_collection_requests r
      where r.collector_page_outcome in ('does_not_exist', 'unlisted', 'page_error')
      union all
      select r.external_shop_id, r.external_product_id, r.collector_page_outcome, r.updated_at
      from public.store_collection_requests r
      where r.collector_page_outcome in ('does_not_exist', 'unlisted', 'page_error')
    ) q
    where not exists (
      select 1 from public.products p
      where p.platform = 'shopee' and p.is_active and p.tracking_enabled
        and p.external_shop_id = q.shop_id and p.external_product_id = q.product_id
    )
    order by q.shop_id, q.product_id, q.updated_at desc
  ), queue_counts as (
    select
      count(*) filter (where outcome = 'does_not_exist') as does_not_exist_count,
      count(*) filter (where outcome = 'unlisted') as unlisted_count,
      count(*) filter (where outcome = 'page_error') as page_error_count
    from queue_outcomes
  )
  select tracked.total_tracked, tracked.total_due, tracked.sold_out_deferred,
    (
      select count(*) from public.product_daily_checks c
      join public.products p on p.id = c.product_id
      where c.checked_date = (now() at time zone 'Asia/Manila')::date
        and c.status = 'success'
        and c.metadata ->> 'all_variations_unchanged' = 'true'
        and p.platform = 'shopee' and p.is_active and p.tracking_enabled
    ),
    tracked.does_not_exist_count + queue_counts.does_not_exist_count,
    tracked.unlisted_count + queue_counts.unlisted_count,
    tracked.page_error_count + queue_counts.page_error_count
  from tracked cross join queue_counts;
$function$;


CREATE OR REPLACE FUNCTION public.collector_backlog_begin()
 RETURNS TABLE(backlog_id uuid, total bigint, remaining bigint, finished boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(21976271);
  select b.id into v_id from public.collector_backlogs b where b.finished_at is null limit 1;
  if v_id is null then
    insert into public.collector_backlogs default values returning id into v_id;
    insert into public.collector_backlog_products (backlog_id, product_id)
    select v_id, p.id from public.products p
    where p.platform = 'shopee' and p.is_active and p.tracking_enabled
      and (public.is_double_sale_day() or p.all_variations_sold_out is distinct from true)
      and (
        public.is_double_sale_day()
        or exists (select 1 from public.product_variations v where v.product_id = p.id and v.is_active)
      );
  elsif public.is_double_sale_day() then
    insert into public.collector_backlog_products (backlog_id, product_id)
    select v_id, p.id from public.products p
    where p.platform = 'shopee' and p.is_active and p.tracking_enabled
    on conflict (backlog_id, product_id) do nothing;
  end if;
  return query select b.id, count(bp.product_id),
    count(bp.product_id) filter (where bp.completed_at is null), false
  from public.collector_backlogs b
  left join public.collector_backlog_products bp on bp.backlog_id = b.id
  where b.id = v_id group by b.id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.collector_backlog_complete(p_backlog_id uuid, p_shop_id text, p_external_product_id text, p_outcome text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_remaining bigint;
begin
  update public.collector_backlog_products bp set completed_at = now(), outcome = p_outcome
  from public.products p where bp.product_id = p.id and bp.backlog_id = p_backlog_id
    and bp.completed_at is null and p.platform = 'shopee'
    and p.external_shop_id = p_shop_id and p.external_product_id = p_external_product_id;
  select count(*) into v_remaining from public.collector_backlog_products bp
    where bp.backlog_id = p_backlog_id and bp.completed_at is null;
  if v_remaining = 0 then
    update public.collector_backlogs b set finished_at = coalesce(b.finished_at, now()) where b.id = p_backlog_id;
  end if;
  return v_remaining;
end;
$function$;


CREATE OR REPLACE FUNCTION public.collector_backlog_complete_active(p_shop_id text, p_external_product_id text, p_outcome text, p_backlog_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_id uuid; v_remaining bigint;
begin
  select b.id into v_id from public.collector_backlogs b
  where b.finished_at is null limit 1 for update;
  if v_id is null then return null; end if;
  if p_backlog_id is not null and p_backlog_id <> v_id then return null; end if;
  update public.collector_backlog_products bp
    set completed_at = now(), outcome = p_outcome
  from public.products p
  where bp.product_id = p.id and bp.backlog_id = v_id
    and bp.completed_at is null and p.platform = 'shopee'
    and p.external_shop_id = p_shop_id and p.external_product_id = p_external_product_id;
  select count(*) into v_remaining from public.collector_backlog_products bp
    where bp.backlog_id = v_id and bp.completed_at is null;
  if v_remaining = 0 then
    update public.collector_backlogs b set finished_at = now() where b.id = v_id;
  end if;
  return v_remaining;
end;
$function$;


CREATE OR REPLACE FUNCTION public.collector_backlog_item_state(p_backlog_id uuid, p_shop_id text, p_external_product_id text)
 RETURNS text
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select case when bp.completed_at is null then 'pending' else 'completed' end
  from public.collector_backlog_products bp
  join public.products p on p.id = bp.product_id
  where bp.backlog_id = p_backlog_id and p.platform = 'shopee'
    and p.external_shop_id = p_shop_id and p.external_product_id = p_external_product_id limit 1;
$function$;


CREATE OR REPLACE FUNCTION public.collector_backlog_status()
 RETURNS TABLE(backlog_id uuid, total bigint, remaining bigint, finished boolean)
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select b.id, count(bp.product_id), count(bp.product_id) filter (where bp.completed_at is null),
    b.finished_at is not null
  from public.collector_backlogs b
  left join public.collector_backlog_products bp on bp.backlog_id = b.id
  group by b.id
  order by b.created_at desc limit 1;
$function$;


CREATE OR REPLACE FUNCTION public.complete_public_collection_request(p_platform text, p_external_shop_id text, p_external_product_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_checked_at timestamptz;
begin
  select p.last_checked_at into v_checked_at from public.products p
  where p.platform=p_platform and p.external_shop_id=p_external_shop_id
    and p.external_product_id=p_external_product_id;
  update public.public_collection_requests r set
    status='completed', lease_until=null,
    completed_at=coalesce(v_checked_at,now()),
    eligible_at=case when r.one_time then 'infinity'::timestamptz
      else coalesce(v_checked_at,now())+interval '5 days' end,
    updated_at=now()
  where r.platform=p_platform and r.external_shop_id=p_external_shop_id
    and r.external_product_id=p_external_product_id and r.status<>'removed'
    and (not r.one_time or r.status='leased')
    and (r.completed_at is null or r.completed_at<coalesce(v_checked_at,now()));
end;
$function$;


CREATE OR REPLACE FUNCTION public.enqueue_public_collection_request(p_requester_hash text, p_external_shop_id text, p_external_product_id text, p_product_url text, p_requested_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing_request public.public_collection_requests%rowtype;
  v_has_existing_request boolean;
  v_request_count integer;
begin
  if p_requester_hash is null or p_requester_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid requester hash';
  end if;

  if p_requested_date is null then
    raise exception 'requested date is required';
  end if;

  if p_external_shop_id is null or p_external_shop_id !~ '^[0-9]+$'
    or p_external_product_id is null or p_external_product_id !~ '^[0-9]+$'
    or p_product_url is null or p_product_url = '' then
    raise exception 'invalid product identity';
  end if;

  -- Serialize both existing and first-time requests for the same Shopee identity.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'shopee:' || p_external_shop_id || ':' || p_external_product_id,
      0
    )
  );

  select r.*
  into v_existing_request
  from public.public_collection_requests r
  where r.platform = 'shopee'
    and r.external_shop_id = p_external_shop_id
    and r.external_product_id = p_external_product_id
  for update;

  v_has_existing_request := found;

  if v_has_existing_request
    and v_existing_request.status in ('pending', 'leased') then
    return pg_catalog.jsonb_build_object('status', 'duplicate');
  end if;

  -- A completed product can be requested again on a later Manila day.
  -- A successful check today must not be put back in Priority Queue today.
  if exists (
    select 1 from public.products p
    join public.product_daily_checks c on c.product_id = p.id
    where p.platform = 'shopee'
      and p.external_shop_id = p_external_shop_id
      and p.external_product_id = p_external_product_id
      and c.checked_date = (now() at time zone 'Asia/Manila')::date
      and c.status = 'success'
  ) then
    return pg_catalog.jsonb_build_object('status', 'checked_today');
  end if;

  insert into public.public_collection_request_quotas (
    requester_hash,
    requested_date,
    request_count
  ) values (
    p_requester_hash,
    p_requested_date,
    0
  )
  on conflict (requester_hash, requested_date) do nothing;

  select q.request_count
  into v_request_count
  from public.public_collection_request_quotas q
  where q.requester_hash = p_requester_hash
    and q.requested_date = p_requested_date
  for update;

  if v_request_count >= 100 then
    return pg_catalog.jsonb_build_object('status', 'limit_reached');
  end if;

  update public.public_collection_request_quotas q
  set request_count = request_count + 1,
      updated_at = now()
  where q.requester_hash = p_requester_hash
    and q.requested_date = p_requested_date;

  if v_has_existing_request then
    update public.public_collection_requests r
    set status = 'pending',
        product_url = p_product_url,
        requested_at = now(),
        eligible_at = now(),
        collector_page_outcome = null,
        lease_until = null,
        attempt_count = 0,
        completed_at = null,
        updated_at = now()
    where r.request_id = v_existing_request.request_id;
  else
    insert into public.public_collection_requests (
      platform,
      external_shop_id,
      external_product_id,
      product_url
    ) values (
      'shopee',
      p_external_shop_id,
      p_external_product_id,
      p_product_url
    );
  end if;

  return pg_catalog.jsonb_build_object('status', 'queued');
end;
$function$;


CREATE OR REPLACE FUNCTION public.import_store_collection_batch(p_scan_id uuid, p_products jsonb, p_pages_current integer, p_pages_total integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_store public.collection_stores%rowtype;
  v_product jsonb;
  v_shop_id text;
  v_product_id text;
  v_product_url text;
  v_sold_out boolean;
  v_previous_sold_out boolean;
  v_discovered integer := 0;
  v_newly_queued integer := 0;
  v_duplicate integer := 0;
  v_already_tracked integer := 0;
  v_sold_out_count integer := 0;
  v_result public.store_scan_history%rowtype;
begin
  if p_scan_id is null or p_products is null or pg_catalog.jsonb_typeof(p_products) <> 'array'
    or pg_catalog.jsonb_array_length(p_products) > 5000
    or p_pages_current is null or p_pages_current < 0
    or p_pages_total is null or p_pages_total < 0
    or (p_pages_total > 0 and p_pages_current > p_pages_total) then
    raise exception 'invalid store batch';
  end if;

  select s.* into v_store
  from public.collection_stores s
  where s.last_scan_id = p_scan_id
  for update;
  if not found then raise exception 'unknown store scan'; end if;

  perform 1 from public.store_scan_history h where h.scan_id = p_scan_id for update;
  if not found then raise exception 'unknown store scan history'; end if;

  for v_product in select value from pg_catalog.jsonb_array_elements(p_products)
  loop
    v_shop_id := v_product ->> 'shopId';
    v_product_id := coalesce(v_product ->> 'externalProductId', v_product ->> 'productId');
    v_product_url := v_product ->> 'productUrl';
    v_sold_out := coalesce((v_product ->> 'soldOut')::boolean, false);
    if v_shop_id is null or v_shop_id !~ '^[1-9][0-9]*$'
      or v_product_id is null or v_product_id !~ '^[1-9][0-9]*$'
      or v_product_url is null or v_product_url = '' then
      raise exception 'invalid product identity';
    end if;

    select d.sold_out into v_previous_sold_out
    from public.store_scan_discoveries d
    where d.scan_id = p_scan_id
      and d.external_shop_id = v_shop_id
      and d.external_product_id = v_product_id;

    if found then
      if v_sold_out and not v_previous_sold_out then
        update public.store_scan_discoveries
        set sold_out = true
        where scan_id = p_scan_id
          and external_shop_id = v_shop_id
          and external_product_id = v_product_id;
        v_sold_out_count := v_sold_out_count + 1;
        update public.store_collection_requests
        set discovered_sold_out = true,
            eligible_at = greatest(eligible_at, now() + interval '15 days'),
            updated_at = now()
        where platform = 'shopee'
          and external_shop_id = v_shop_id
          and external_product_id = v_product_id
          and status = 'pending';
        update public.products
        set all_variations_sold_out = true,
            next_check_at = greatest(coalesce(next_check_at, now()), now() + interval '15 days')
        where platform = 'shopee'
          and external_shop_id = v_shop_id
          and external_product_id = v_product_id;
      end if;
      continue;
    end if;

    insert into public.store_scan_discoveries (
      scan_id, external_shop_id, external_product_id, sold_out
    ) values (
      p_scan_id, v_shop_id, v_product_id, v_sold_out
    );
    v_discovered := v_discovered + 1;
    if v_sold_out then v_sold_out_count := v_sold_out_count + 1; end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('store:shopee:' || v_shop_id || ':' || v_product_id, 0)
    );

    if exists (
      select 1 from public.products p
      where p.platform = 'shopee'
        and p.external_shop_id = v_shop_id
        and p.external_product_id = v_product_id
    ) then
      v_already_tracked := v_already_tracked + 1;
      if v_sold_out then
        update public.products
        set all_variations_sold_out = true,
            next_check_at = greatest(coalesce(next_check_at, now()), now() + interval '15 days')
        where platform = 'shopee'
          and external_shop_id = v_shop_id
          and external_product_id = v_product_id;
      end if;
    elsif exists (
      select 1 from public.store_collection_requests r
      where r.platform = 'shopee'
        and r.external_shop_id = v_shop_id
        and r.external_product_id = v_product_id
    ) then
      update public.store_collection_requests
      set last_seen_at = now(),
          discovered_sold_out = discovered_sold_out or v_sold_out,
          eligible_at = case
            when v_sold_out and status = 'pending'
              then greatest(eligible_at, now() + interval '15 days')
            else eligible_at
          end,
          updated_at = now()
      where platform = 'shopee'
        and external_shop_id = v_shop_id
        and external_product_id = v_product_id;
      v_duplicate := v_duplicate + 1;
    else
      insert into public.store_collection_requests (
        store_id, platform, external_shop_id, external_product_id, product_url,
        discovered_sold_out, eligible_at
      ) values (
        v_store.store_id, 'shopee', v_shop_id, v_product_id, v_product_url,
        v_sold_out, case when v_sold_out then now() + interval '15 days' else now() end
      );
      -- A newly inserted request is a newly queued item even when sold out.
      -- Sold-out eligibility remains deferred for 15 days.
      v_newly_queued := v_newly_queued + 1;
    end if;
  end loop;

  update public.store_scan_history h
  set discovered = h.discovered + v_discovered,
      newly_queued = h.newly_queued + v_newly_queued,
      duplicate = h.duplicate + v_duplicate,
      already_tracked = h.already_tracked + v_already_tracked,
      sold_out = h.sold_out + v_sold_out_count,
      pages_current = greatest(h.pages_current, p_pages_current),
      pages_total = greatest(h.pages_total, p_pages_total)
  where h.scan_id = p_scan_id
  returning * into v_result;

  update public.collection_stores s
  set last_discovered = v_result.discovered,
      last_newly_queued = v_result.newly_queued,
      last_duplicate = v_result.duplicate,
      last_already_tracked = v_result.already_tracked,
      last_sold_out = v_result.sold_out,
      last_pages_current = v_result.pages_current,
      last_pages_total = v_result.pages_total,
      updated_at = now()
  where s.store_id = v_store.store_id;

  return pg_catalog.jsonb_build_object(
    'discovered', v_discovered,
    'newlyQueued', v_newly_queued,
    'duplicate', v_duplicate,
    'alreadyTracked', v_already_tracked,
    'soldOut', v_sold_out_count,
    'pagesCurrent', v_result.pages_current,
    'pagesTotal', v_result.pages_total
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.keep_recorded_products_out_of_sq()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (
    select 1 from public.products p
    where p.platform = new.platform and p.external_shop_id = new.external_shop_id
      and p.external_product_id = new.external_product_id and p.last_checked_at is not null
  ) then
    if tg_op = 'INSERT' then return null; end if;
    new.status := 'completed';
    new.lease_until := null;
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.mark_collector_product_outcome(p_claim_source text, p_queue_request_id uuid, p_product_id bigint, p_external_shop_id text, p_external_product_id text, p_outcome text, p_checked_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product_id bigint;
  v_sold_out_count integer := 0;
  v_unavailable_count integer := 0;
  v_page_error_count integer := 0;
  v_delay interval;
  v_eligible_at timestamptz;
begin
  if p_claim_source not in ('priority', 'store', 'random')
    or p_outcome not in ('sold_out', 'does_not_exist', 'unlisted', 'page_error')
    or p_external_shop_id !~ '^[0-9]+$'
    or p_external_product_id !~ '^[0-9]+$' then
    raise exception 'invalid collector outcome';
  end if;

  select p.id into v_product_id
  from public.products p
  where p.platform = 'shopee'
    and p.external_shop_id = p_external_shop_id
    and p.external_product_id = p_external_product_id
  limit 1
  for update;

  if p_claim_source = 'random'
    and (p_product_id is null or v_product_id is distinct from p_product_id) then
    raise exception 'collector product identity mismatch';
  end if;

  if p_outcome = 'sold_out' then
    if v_product_id is not null then
      select p.consecutive_sold_out_checks into v_sold_out_count
      from public.products p where p.id = v_product_id;
    elsif p_claim_source = 'priority' then
      select r.consecutive_sold_out_checks into v_sold_out_count
      from public.public_collection_requests r
      where r.request_id = p_queue_request_id for update;
    else
      select r.consecutive_sold_out_checks into v_sold_out_count
      from public.store_collection_requests r
      where r.request_id = p_queue_request_id for update;
    end if;
    v_sold_out_count := coalesce(v_sold_out_count, 0) + 1;
    v_delay := case when v_sold_out_count = 1
      then interval '15 days' else interval '30 days' end;

  elsif p_outcome in ('does_not_exist', 'unlisted') then
    if v_product_id is not null then
      select p.consecutive_unavailable_checks into v_unavailable_count
      from public.products p where p.id = v_product_id;
    elsif p_claim_source = 'priority' then
      select r.consecutive_unavailable_checks into v_unavailable_count
      from public.public_collection_requests r
      where r.request_id = p_queue_request_id for update;
    else
      select r.consecutive_unavailable_checks into v_unavailable_count
      from public.store_collection_requests r
      where r.request_id = p_queue_request_id for update;
    end if;
    v_unavailable_count := coalesce(v_unavailable_count, 0) + 1;
    v_delay := interval '30 days';

  else
    if v_product_id is not null then
      select p.consecutive_page_errors into v_page_error_count
      from public.products p where p.id = v_product_id;
    elsif p_claim_source = 'priority' then
      select r.consecutive_page_errors into v_page_error_count
      from public.public_collection_requests r
      where r.request_id = p_queue_request_id for update;
    else
      select r.consecutive_page_errors into v_page_error_count
      from public.store_collection_requests r
      where r.request_id = p_queue_request_id for update;
    end if;
    v_page_error_count := coalesce(v_page_error_count, 0) + 1;
    v_delay := case
      when v_page_error_count = 1 then interval '0 seconds'
      when v_page_error_count = 2 then interval '30 days'
      else interval '30 days'
    end;
  end if;

  v_eligible_at := coalesce(p_checked_at, now()) + v_delay;

  if v_product_id is not null then
    update public.products p
    set collector_page_outcome = p_outcome,
        consecutive_sold_out_checks = case
          when p_outcome = 'sold_out' then v_sold_out_count
          else p.consecutive_sold_out_checks
        end,
        consecutive_unavailable_checks = case
          when p_outcome in ('does_not_exist', 'unlisted') then v_unavailable_count
          else p.consecutive_unavailable_checks
        end,
        consecutive_page_errors = case
          when p_outcome = 'page_error' then v_page_error_count
          else p.consecutive_page_errors
        end,
        all_variations_sold_out = case
          when p_outcome = 'sold_out' then true
          else p.all_variations_sold_out
        end,
        stock_status_checked_at = case
          when p_outcome = 'sold_out' then coalesce(p_checked_at, now())
          else p.stock_status_checked_at
        end,
        next_check_at = v_eligible_at,
        last_check_attempt_at = coalesce(p_checked_at, now()),
        last_check_status = case when p_outcome = 'sold_out' then 'success' else 'failure' end,
        check_lease_until = null
    where p.id = v_product_id;
  end if;

  if p_claim_source = 'priority' then
    update public.public_collection_requests r
    set status = case when v_eligible_at > now() then 'leased' else 'pending' end,
        lease_until = case when v_eligible_at > now() then v_eligible_at else null end,
        eligible_at = v_eligible_at,
        collector_page_outcome = p_outcome,
        consecutive_sold_out_checks = case
          when p_outcome = 'sold_out' then v_sold_out_count
          else r.consecutive_sold_out_checks
        end,
        consecutive_unavailable_checks = case
          when p_outcome in ('does_not_exist', 'unlisted') then v_unavailable_count
          else r.consecutive_unavailable_checks
        end,
        consecutive_page_errors = case
          when p_outcome = 'page_error' then v_page_error_count
          else r.consecutive_page_errors
        end,
        updated_at = now()
    where r.request_id = p_queue_request_id
      and r.external_shop_id = p_external_shop_id
      and r.external_product_id = p_external_product_id;

  elsif p_claim_source = 'store' then
    update public.store_collection_requests r
    set status = case when v_eligible_at > now() then 'leased' else 'pending' end,
        lease_until = case when v_eligible_at > now() then v_eligible_at else null end,
        eligible_at = v_eligible_at,
        collector_page_outcome = p_outcome,
        consecutive_sold_out_checks = case
          when p_outcome = 'sold_out' then v_sold_out_count
          else r.consecutive_sold_out_checks
        end,
        consecutive_unavailable_checks = case
          when p_outcome in ('does_not_exist', 'unlisted') then v_unavailable_count
          else r.consecutive_unavailable_checks
        end,
        consecutive_page_errors = case
          when p_outcome = 'page_error' then v_page_error_count
          else r.consecutive_page_errors
        end,
        updated_at = now()
    where r.request_id = p_queue_request_id
      and r.external_shop_id = p_external_shop_id
      and r.external_product_id = p_external_product_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'outcome', p_outcome,
    'eligibleAt', v_eligible_at,
    'recheckAt', case when v_delay > interval '0 seconds' then v_eligible_at else null end,
    'retryAfterCurrentRun', p_outcome = 'page_error' and v_page_error_count = 1
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.reclaim_collector_product(p_claim_source text, p_queue_request_id uuid, p_product_id bigint, p_external_shop_id text, p_external_product_id text, p_lease_until timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_claimed integer := 0;
begin
  if p_lease_until is null or p_lease_until <= now() then raise exception 'invalid retry lease'; end if;
  if p_claim_source = 'random' then
    update public.products set check_lease_until=p_lease_until,last_check_attempt_at=now()
    where id=p_product_id and external_shop_id=p_external_shop_id and external_product_id=p_external_product_id
      and coalesce(next_check_at,now())<=now() and (check_lease_until is null or check_lease_until<now());
  elsif p_claim_source = 'priority' then
    update public.public_collection_requests set status='leased',lease_until=p_lease_until,attempt_count=attempt_count+1,updated_at=now()
    where request_id=p_queue_request_id and external_shop_id=p_external_shop_id and external_product_id=p_external_product_id
      and status='pending' and eligible_at<=now();
  elsif p_claim_source = 'store' then
    update public.store_collection_requests set status='leased',lease_until=p_lease_until,attempt_count=attempt_count+1,updated_at=now()
    where request_id=p_queue_request_id and external_shop_id=p_external_shop_id and external_product_id=p_external_product_id
      and status='pending' and eligible_at<=now();
  else raise exception 'invalid retry source';
  end if;
  get diagnostics v_claimed = row_count;
  return v_claimed > 0;
end;
$function$;


CREATE OR REPLACE FUNCTION public.store_collection_queue_pending_count()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select count(*) from public.store_collection_requests r
where r.status in ('pending','leased') and r.eligible_at <= now()
and not exists (select 1 from public.products p where p.platform=r.platform
and p.external_shop_id=r.external_shop_id and p.external_product_id=r.external_product_id);
$function$;


CREATE OR REPLACE FUNCTION public.upsert_store_listing_metadata(p_scan_id uuid, p_products jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product jsonb;
  v_shop_id text;
  v_product_id text;
  v_rating numeric;
  v_review_count bigint;
  v_updated integer := 0;
begin
  if p_scan_id is null or p_products is null
    or pg_catalog.jsonb_typeof(p_products) <> 'array'
    or pg_catalog.jsonb_array_length(p_products) > 5000
    or not exists (select 1 from public.store_scan_history where scan_id = p_scan_id) then
    raise exception 'invalid store metadata batch';
  end if;

  for v_product in select value from pg_catalog.jsonb_array_elements(p_products)
  loop
    v_shop_id := v_product ->> 'shopId';
    v_product_id := coalesce(v_product ->> 'externalProductId', v_product ->> 'productId');
    if v_shop_id is null or v_shop_id !~ '^[1-9][0-9]*$'
      or v_product_id is null or v_product_id !~ '^[1-9][0-9]*$' then
      raise exception 'invalid product identity';
    end if;

    v_rating := case when coalesce(v_product ->> 'rating', '') ~ '^\d(?:\.\d+)?$'
      and (v_product ->> 'rating')::numeric between 0 and 5
      then (v_product ->> 'rating')::numeric else null end;
    v_review_count := case when coalesce(v_product ->> 'reviewCount', '') ~ '^\d{1,18}$'
      then (v_product ->> 'reviewCount')::bigint else null end;

    update public.products
    set rating = coalesce(v_rating, rating),
        review_count = coalesce(v_review_count, review_count),
        activity_observed_at = case
          when v_rating is not null or v_review_count is not null then now()
          else activity_observed_at
        end,
        updated_at = now()
    where platform = 'shopee'
      and external_shop_id = v_shop_id
      and external_product_id = v_product_id;

    v_updated := v_updated + 1;
  end loop;
  return v_updated;
end;
$function$;


CREATE OR REPLACE FUNCTION public.complete_store_collection_request(p_platform text, p_external_shop_id text, p_external_product_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.store_collection_requests r
  set status = 'completed', lease_until = null, completed_at = now(), updated_at = now()
  where r.platform = p_platform
    and r.external_shop_id = p_external_shop_id
    and r.external_product_id = p_external_product_id
    and r.status in ('pending', 'leased');
end;
$function$;


CREATE OR REPLACE FUNCTION public.enqueue_firefox_collection_request(p_external_shop_id text, p_external_product_id text, p_product_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_external_shop_id !~ '^[0-9]+$' or p_external_product_id !~ '^[0-9]+$'
    or p_product_url is null or p_product_url = '' then
    raise exception 'invalid product identity';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'shopee:' || p_external_shop_id || ':' || p_external_product_id, 0));
  insert into public.public_collection_requests as r (
    platform, external_shop_id, external_product_id, product_url, one_time
  ) values ('shopee', p_external_shop_id, p_external_product_id, p_product_url, true)
  on conflict (platform, external_shop_id, external_product_id) do update set
    one_time = true,
    product_url = excluded.product_url,
    status = 'pending',
    requested_at = case when r.status = 'pending' then r.requested_at else now() end,
    eligible_at = case when r.status = 'pending' then r.eligible_at else now() end,
    completed_at = null, lease_until = null,
    attempt_count = case when r.status = 'pending' then r.attempt_count else 0 end,
    collector_page_outcome = null, updated_at = now()
  where r.status <> 'leased' or r.lease_until < now();
end;
$function$;


CREATE OR REPLACE FUNCTION public.is_double_sale_day()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select extract(month from (now() at time zone 'Asia/Manila'))::int
       = extract(day from (now() at time zone 'Asia/Manila'))::int;
$function$;


CREATE OR REPLACE FUNCTION public.shopee_sale_window(p_day date)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_day is not null and (
    extract(day from p_day)::integer >= least(29, extract(day from date_trunc('month', p_day::timestamp) + interval '1 month - 1 day')::integer)
    or extract(day from p_day)::integer = 1
    or extract(day from p_day)::integer between 14 and 16
    or extract(day from p_day)::integer between extract(month from p_day)::integer - 1 and extract(month from p_day)::integer + 1
  );
$function$;

