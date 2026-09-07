import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("collector history stores same-price totals and next-check timestamps", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260911_collector_same_price_history.sql", import.meta.url), "utf8");

  assert.match(sql, /add column if not exists same_price integer not null default 0/i);
  assert.match(sql, /add column if not exists same_price_recheck_at timestamptz/i);
  assert.match(sql, /same_price_deferred bigint/i);
  assert.match(sql, /all_variations_unchanged/i);
  assert.match(sql, /skip_unchanged_day/i);
});
