drop function if exists public.import_store_collection_batch(uuid, jsonb);
drop function if exists public.finish_store_collection_scan(uuid, text);

notify pgrst, 'reload schema';
