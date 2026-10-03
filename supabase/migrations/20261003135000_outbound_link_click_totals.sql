create table public.outbound_link_click_counts (
  link_type text primary key check (link_type in ('shopee','affiliate')),
  click_count bigint not null default 0 check (click_count >= 0)
);
insert into public.outbound_link_click_counts(link_type) values ('shopee'),('affiliate');
alter table public.outbound_link_click_counts enable row level security;
revoke all on public.outbound_link_click_counts from public,anon,authenticated;
grant select,update on public.outbound_link_click_counts to service_role;
create function public.increment_outbound_link_click(p_link_type text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_link_type not in ('shopee','affiliate') or p_link_type is null then
    raise exception 'Invalid link type';
  end if;
  update public.outbound_link_click_counts set click_count=click_count+1 where link_type=p_link_type;
end;
$$;
revoke all on function public.increment_outbound_link_click(text) from public,anon,authenticated;
grant execute on function public.increment_outbound_link_click(text) to service_role;