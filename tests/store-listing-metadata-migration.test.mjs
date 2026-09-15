import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20260915_store_listing_metadata.sql", import.meta.url), "utf8");

test("stores nullable listing metadata on discoveries, queue requests, and tracked products", () => {
  assert.match(sql, /alter table public\.store_scan_discoveries[\s\S]*total_sold/);
  assert.match(sql, /alter table public\.store_collection_requests[\s\S]*shopee_sales_activity/);
  assert.match(sql, /alter table public\.products[\s\S]*shopee_sales_activity/);
  assert.match(sql, /create or replace function public\.upsert_store_listing_metadata/);
  assert.match(sql, /coalesce\(v_total_sold, total_sold\)/);
});

test("keeps metadata RPC private to the service role", () => {
  assert.match(sql, /revoke all on function public\.upsert_store_listing_metadata\(uuid,jsonb\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.upsert_store_listing_metadata\(uuid,jsonb\) to service_role/);
});
