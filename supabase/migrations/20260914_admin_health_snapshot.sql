-- Return the Health summary and first history batch in one database round trip.
create or replace function public.admin_health_snapshot(p_limit integer default 200)
returns jsonb language sql stable security definer set search_path = '' as $$
  with windowed as (
    select * from public.diagnostic_events
    where created_at >= now() - interval '30 days'
  ), recent as (
    select * from windowed order by created_at desc limit least(greatest(p_limit, 1), 500)
  )
  select jsonb_build_object(
    'windowDays', 30,
    'generatedAt', now(),
    'summary', jsonb_build_object(
      'total', (select count(*) from windowed),
      'failures', (select count(*) from windowed where event_type = 'record_failure'),
      'partial', (select count(*) from windowed where event_type = 'record_partial'),
      'duplicates', (select count(*) from windowed where event_type = 'duplicate_blocked'),
      'variationChanges', (select count(*) from windowed where event_type = 'variation_count_changed'),
      'lastSuccess', (select max(created_at) from windowed where event_type = 'record_success')
    ),
    'events', coalesce((select jsonb_agg(to_jsonb(recent) order by created_at desc) from recent), '[]'::jsonb),
    'hasMore', (select count(*) from recent) = least(greatest(p_limit, 1), 500)
  );
$$;

revoke all on function public.admin_health_snapshot(integer) from public, anon, authenticated;
grant execute on function public.admin_health_snapshot(integer) to service_role;
