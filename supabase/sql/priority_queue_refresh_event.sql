create or replace function public.notify_priority_queue_changed()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform realtime.send('{}'::jsonb, 'priority-changed', 'admin-priority-queue', false);
  return null;
exception when others then
  raise warning 'Priority refresh event failed: %', SQLERRM;
  return null;
end;
$$;
revoke all on function public.notify_priority_queue_changed() from public, anon, authenticated;
create trigger priority_queue_refresh_event
after insert or update or delete on public.public_collection_requests
for each statement execute function public.notify_priority_queue_changed();
