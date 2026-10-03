-- Count recorded batch members regardless of the collector's batch switch.
create or replace function public.complete_saved_batch_on_recording()
returns trigger language plpgsql set search_path = '' as $$
declare v_batch_id uuid; v_created_at timestamptz;
begin
  if new.status <> 'success' then return new; end if;
  select b.id, b.created_at into v_batch_id, v_created_at
  from public.collector_backlogs b where b.finished_at is null
  order by b.created_at desc limit 1 for update;
  if v_batch_id is null or new.checked_at < v_created_at then return new; end if;
  update public.collector_backlog_products
  set completed_at = new.checked_at, outcome = 'checked'
  where backlog_id = v_batch_id and product_id = new.product_id and completed_at is null;
  if found and not exists (
    select 1 from public.collector_backlog_products
    where backlog_id = v_batch_id and completed_at is null
  ) then
    update public.collector_backlogs set finished_at = now() where id = v_batch_id;
  end if;
  return new;
end;
$$;
revoke all on function public.complete_saved_batch_on_recording() from public, anon, authenticated;
grant execute on function public.complete_saved_batch_on_recording() to service_role;
create trigger complete_saved_batch_on_recording
after insert or update on public.product_daily_checks
for each row execute function public.complete_saved_batch_on_recording();

-- Reconcile successful recordings missed by the former collector-only path.
update public.collector_backlog_products bp
set completed_at = p.last_checked_at, outcome = 'checked'
from public.collector_backlogs b, public.products p
where bp.backlog_id = b.id and b.finished_at is null
  and bp.product_id = p.id and bp.completed_at is null
  and p.last_checked_at >= b.created_at;
update public.collector_backlogs b set finished_at = now()
where b.finished_at is null and not exists (
  select 1 from public.collector_backlog_products bp
  where bp.backlog_id = b.id and bp.completed_at is null
);
