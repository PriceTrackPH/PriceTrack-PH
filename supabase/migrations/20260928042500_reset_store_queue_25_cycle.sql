-- Begin a fresh 25:1 cycle after replacing the old 50:1 selection rule.
update public.store_queue_selection_state
set available_since_sold_out = 0,
    cycle_shop_ids = '{}'::text[]
where id = 1;
