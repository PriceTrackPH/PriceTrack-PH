import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("latest collector scheduling migration preserves both unchecked toggles", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260912_collector_toggle_scheduling_fix.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /p_metadata\s*->>\s*'skip_sold_out'/i);
  assert.match(sql, /p_metadata\s*->>\s*'skip_unchanged_day'/i);
  assert.match(sql, /v_all_sold_out and not v_skip_sold_out[\s\S]+interval '1 day'/i);
  assert.match(sql, /v_all_sold_out and v_skip_sold_out[\s\S]+interval '15 days'/i);
  assert.match(sql, /v_skip_unchanged_day and v_all_variations_unchanged[\s\S]+interval '2 days'/i);
  assert.match(sql, /when p_status = 'success' then[\s\S]+interval '1 day'/i);
});
