import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20260905_sold_out_fifteen_day_schedule.sql",
  import.meta.url,
);

test("fully sold-out products are checked again after fifteen days", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /v_all_sold_out[\s\S]+interval '15 days'/);
  assert.match(sql, /when p_status = 'success' then p_checked_at \+ interval '24 hours'/);
  assert.doesNotMatch(sql, /interval '7 days'/);
});

test("existing sold-out products are moved onto the fifteen-day schedule", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /update public\.products/);
  assert.match(sql, /all_variations_sold_out is true/);
  assert.match(sql, /not exists[\s\S]+public\.product_variations/);
  assert.match(sql, /interval '15 days'/);
});
