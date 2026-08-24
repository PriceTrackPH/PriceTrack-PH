create or replace function public.consume_ingest_quota(
  p_client_hash text,
  p_observed_date date,
  p_limit integer default 200
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_client_hash is null or length(p_client_hash) <> 64 then
    raise exception 'invalid client hash';
  end if;

  if p_limit < 1 or p_limit > 500 then
    raise exception 'invalid rate limit';
  end if;

  insert into public.ingest_rate_limits (
    client_hash,
    observed_date,
    request_count,
    last_request_at
  ) values (
    p_client_hash,
    p_observed_date,
    1,
    now()
  )
  on conflict (client_hash, observed_date)
  do update set
    request_count = public.ingest_rate_limits.request_count + 1,
    last_request_at = now()
  where public.ingest_rate_limits.request_count < p_limit
  returning request_count into v_count;

  return v_count;
end;
$$;
