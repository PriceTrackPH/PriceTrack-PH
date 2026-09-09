do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.import_store_collection_batch(uuid,jsonb,integer,integer)'::regprocedure
  ) into v_definition;
  execute replace(v_definition, 'pg_catalog.greatest', 'greatest');

  select pg_catalog.pg_get_functiondef(
    'public.finish_store_collection_scan(uuid,text,integer,integer)'::regprocedure
  ) into v_definition;
  execute replace(v_definition, 'pg_catalog.greatest', 'greatest');
end;
$$;

notify pgrst, 'reload schema';
