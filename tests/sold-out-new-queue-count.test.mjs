import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20260911031618_fix_sold_out_new_queue_count.sql", import.meta.url),
  "utf8",
);

test("newly inserted sold-out store requests count as newly queued", () => {
  assert.match(
    migration,
    /insert into public\.store_collection_requests[\s\S]*discovered_sold_out, eligible_at[\s\S]*case when v_sold_out then now\(\) \+ interval '15 days' else now\(\) end[\s\S]*v_newly_queued := v_newly_queued \+ 1;/i,
  );
  assert.doesNotMatch(
    migration,
    /if not v_sold_out then\s*v_newly_queued := v_newly_queued \+ 1;\s*end if;/i,
  );
});
