import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20260907233418_store_collection_queue.sql", import.meta.url), "utf8");

test("creates private saved stores and a deduplicated store collection queue", () => {
  assert.match(sql, /create table public\.collection_stores/i);
  assert.match(sql, /store_key text not null unique/i);
  assert.match(sql, /create table public\.store_collection_requests/i);
  assert.match(sql, /unique \(platform, external_shop_id, external_product_id\)/i);
  assert.match(sql, /create index store_collection_requests_fifo_idx[\s\S]*first_discovered_at/i);
  assert.match(sql, /alter table public\.collection_stores enable row level security/i);
  assert.match(sql, /alter table public\.store_collection_requests enable row level security/i);
  assert.match(sql, /revoke all on table public\.collection_stores from public, anon, authenticated/i);
  assert.match(sql, /revoke all on table public\.store_collection_requests from public, anon, authenticated/i);
});

test("declares service-only scan lifecycle and queue RPCs", () => {
  for (const signature of [
    "begin_store_collection_scan(text,text,text,uuid)",
    "import_store_collection_batch(uuid,jsonb)",
    "finish_store_collection_scan(uuid,text)",
    "claim_oldest_store_collection_request(uuid[],timestamptz)",
    "release_store_collection_request(uuid,timestamptz)",
    "complete_store_collection_request(text,text,text)",
    "store_collection_queue_pending_count()",
  ]) {
    const escaped = signature.replace(/[()\[\],]/g, "\\$&");
    assert.match(sql, new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${escaped} to service_role`, "i"));
  }
});

test("imports idempotently, excludes tracked products, and claims with an exclusive lease", () => {
  assert.match(sql, /jsonb_array_length\(p_products\)[\s\S]*5000/i);
  assert.match(sql, /from public\.products p[\s\S]*external_shop_id[\s\S]*external_product_id/i);
  assert.match(sql, /on conflict \(platform, external_shop_id, external_product_id\)[\s\S]*do update/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /status = 'leased'[\s\S]*lease_until = p_lease_until/i);
  assert.match(sql, /r\.lease_until = p_expected_lease_until/i);
});

test("finishes scans without overwriting the saved store first-added date", () => {
  assert.match(sql, /first_added_at timestamptz not null default now\(\)/i);
  assert.match(sql, /last_scan_status[\s\S]*check \(last_scan_status in \('completed', 'incomplete', 'failed'\)\)/i);
  assert.match(sql, /function public\.finish_store_collection_scan[\s\S]*last_scan_finished_at = now\(\)/i);
  assert.doesNotMatch(sql, /finish_store_collection_scan[\s\S]*first_added_at\s*=/i);
});
