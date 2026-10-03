-- Read-only backup access. Only the server's service role can invoke these RPCs.
create or replace function public.admin_backup_catalog()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare t record; tables jsonb := '[]'; cols jsonb; pk jsonb; upper_key jsonb; row_count bigint; seq record; sequence_states jsonb := '[]'; last_value_text text; called boolean;
begin
  if coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','') <> 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  for t in select c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by c.relname loop
    select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,
      'collation',case when a.attcollation<>0 and a.attcollation<>(select typcollation from pg_type where oid=a.atttypid) then a.attcollation::regcollation::text end,
      'sequence',(select jsonb_build_object('start',s.seqstart::text,'increment',s.seqincrement::text,'min',s.seqmin::text,'max',s.seqmax::text,'cache',s.seqcache::text,'cycle',s.seqcycle)
        from pg_sequence s where s.seqrelid=pg_get_serial_sequence(format('public.%I',t.relname),a.attname)::regclass)) order by a.attnum)
      into cols from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped;
    select jsonb_agg(a.attname order by k.ord) into pk from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num
      where c.conrelid=t.oid and c.contype='p';
    if pk is null then raise exception 'Backup requires a primary key on %',t.relname; end if;
    execute format('select count(*) from public.%I',t.relname) into row_count;
    execute format('select (select jsonb_object_agg(k,to_jsonb(r)->>k) from jsonb_array_elements_text($1) k) from public.%I r order by %s limit 1',
      t.relname,(select string_agg(format('%I desc',v),',') from jsonb_array_elements_text(pk) v)) into upper_key using pk;
    tables := tables || jsonb_build_array(jsonb_build_object('name',t.relname,'columns',cols,'primaryKey',pk,'upperKey',upper_key,'rowCount',row_count::text,
      'rls',t.relrowsecurity,'forceRls',t.relforcerowsecurity));
  end loop;
  for seq in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S' loop
    execute format('select last_value::text,is_called from public.%I',seq.relname) into last_value_text,called;
    sequence_states := sequence_states || jsonb_build_array(jsonb_build_object('name',seq.relname,'lastValue',last_value_text,'isCalled',called));
  end loop;
  return jsonb_build_object('sequenceStates',sequence_states,'format',1,'schema','public','exportedAt',now(),'tables',tables,
    'functions',(select coalesce(jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'identity',format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'acl',p.proacl)), '[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind='f' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')),
    'constraints',(select coalesce(jsonb_agg(jsonb_build_object('table',r.relname,'name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid))), '[]') from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='public'),
    'indexes',(select coalesce(jsonb_agg(pg_get_indexdef(i.indexrelid)), '[]') from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)),
    'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(tg.oid)), '[]') from pg_trigger tg join pg_class c on c.oid=tg.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not tg.tgisinternal),
    'policies',(select coalesce(jsonb_agg(to_jsonb(p)), '[]') from pg_policies p where p.schemaname='public'),
    'views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_viewdef(c.oid),'options',c.reloptions)), '[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v'),
    'grants',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'privilege',x.privilege_type,'grantable',x.is_grantable)), '[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x where n.nspname='public' and c.relkind in ('r','v')),
    'functionGrants',(select coalesce(jsonb_agg(jsonb_build_object('identity',format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'grantable',x.is_grantable)), '[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where n.nspname='public' and p.prokind='f' and x.privilege_type='EXECUTE' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')),
    'sequences',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'type',format_type(s.seqtypid,null),'start',s.seqstart::text,'increment',s.seqincrement::text,'min',s.seqmin::text,'max',s.seqmax::text,'cache',s.seqcache::text,'cycle',s.seqcycle,'ownerTable',o.relname,'ownerColumn',a.attname,'identity',d.deptype='i')), '[]') from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace left join pg_depend d on d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype in ('a','i') left join pg_class o on o.oid=d.refobjid left join pg_attribute a on a.attrelid=d.refobjid and a.attnum=d.refobjsubid where n.nspname='public'),
    'sequenceGrants',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'privilege',x.privilege_type,'grantable',x.is_grantable)), '[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) x where n.nspname='public' and c.relkind='S'),
    'comments',(select coalesce(jsonb_agg(jsonb_build_object('target',case when d.objsubid>0 then format('COLUMN public.%I.%I',c.relname,a.attname) when c.relkind='S' then format('SEQUENCE public.%I',c.relname) when c.relkind='v' then format('VIEW public.%I',c.relname) else format('TABLE public.%I',c.relname) end,'comment',d.description)), '[]') from pg_description d join pg_class c on d.classoid='pg_class'::regclass and c.oid=d.objoid join pg_namespace n on n.oid=c.relnamespace left join pg_attribute a on a.attrelid=c.oid and a.attnum=d.objsubid where n.nspname='public' and c.relkind in ('r','v','S')),
    'extensions',(select jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion)) from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
    'publications',(select coalesce(jsonb_agg(to_jsonb(p)), '[]') from pg_publication_tables p where p.schemaname='public'),
    'cronJobs',(select coalesce(jsonb_agg(to_jsonb(j)), '[]') from cron.job j),
    'storageObjects',(select count(*) from storage.objects),'authUsers',(select count(*) from auth.users));
end; $$;
revoke all on function public.admin_backup_catalog() from public,anon,authenticated;
grant execute on function public.admin_backup_catalog() to service_role;

create or replace function public.admin_backup_page(p_table text,p_after jsonb default null,p_upper jsonb default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare rel regclass; pk text[]; ordering text; predicates text; rows jsonb; last_key jsonb;
begin
  if coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','') <> 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  select c.oid into rel from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname=p_table;
  if rel is null then raise exception 'Unknown table'; end if;
  select array_agg(a.attname order by k.ord) into pk from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num where c.conrelid=rel and c.contype='p';
  if pk is null then raise exception 'Primary key required'; end if;
  if p_upper is null then return jsonb_build_object('rows','[]'::jsonb,'cursor',null); end if;
  ordering := (select string_agg(format('%I',v),',') from unnest(pk) v);
  predicates := format('(%s) <= (select %s from jsonb_populate_record(null::%s,$2))',ordering,ordering,rel);
  if p_after is not null then predicates := predicates || format(' and (%s) > (select %s from jsonb_populate_record(null::%s,$1))',ordering,ordering,rel); end if;
  execute format('select coalesce(jsonb_agg(row_to_json(r)::text),''[]''::jsonb) from (select * from %s where %s order by %s limit 1000) r',rel,predicates,ordering) into rows using p_after,p_upper;
  if jsonb_array_length(rows)>0 then
    select jsonb_object_agg(k,((rows->>-1)::jsonb)->>k) into last_key from unnest(pk) k;
  end if;
  return jsonb_build_object('rows',rows,'cursor',last_key);
end; $$;
revoke all on function public.admin_backup_page(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.admin_backup_page(text,jsonb,jsonb) to service_role;
