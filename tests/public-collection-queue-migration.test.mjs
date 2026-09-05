import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/20260907_public_collection_queue.sql", import.meta.url),
  "utf8",
);

test("creates a private FIFO public collection queue", () => {
  assert.match(sql, /create table public\.public_collection_requests/i);
  assert.match(sql, /request_id uuid primary key default gen_random_uuid\(\)/i);
  assert.match(sql, /unique \(platform, external_shop_id, external_product_id\)/i);
  assert.match(sql, /requested_at timestamptz not null default now\(\)/i);
  assert.match(sql, /status text not null default 'pending'/i);
  assert.match(sql, /lease_until timestamptz/i);
  assert.match(sql, /attempt_count integer not null default 0/i);
  assert.match(sql, /completed_at timestamptz/i);
  assert.match(sql, /created_at timestamptz not null default now\(\)/i);
  assert.match(sql, /updated_at timestamptz not null default now\(\)/i);
  assert.match(sql, /order by requested_at asc/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /revoke all on table public\.public_collection_requests from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /grant select .*public_collection_requests.*(?:anon|authenticated)/is);
});

test("enforces 100 distinct mobile requests per Manila day", () => {
  assert.match(sql, /create table public\.public_collection_request_quotas/i);
  assert.match(sql, /primary key \(requester_hash, requested_date\)/i);
  assert.match(sql, /p_requested_date/i);
  assert.match(sql, /request_count >= 100/i);
  assert.match(sql, /jsonb_build_object\('status', 'limit_reached'\)/i);
  assert.match(sql, /revoke all on table public\.public_collection_request_quotas from public, anon, authenticated/i);
});

test("checks duplicates under a product-identity lock before consuming quota", () => {
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*p_external_shop_id[\s\S]*p_external_product_id/i);

  const duplicate = sql.indexOf("jsonb_build_object('status', 'duplicate')");
  const quotaLimit = sql.indexOf("request_count >= 100");
  const quotaIncrement = sql.indexOf("request_count = request_count + 1");
  assert.notEqual(duplicate, -1);
  assert.notEqual(quotaLimit, -1);
  assert.notEqual(quotaIncrement, -1);
  assert.ok(duplicate < quotaLimit, "duplicate return must happen before the quota limit check");
  assert.ok(duplicate < quotaIncrement, "duplicate return must happen before quota consumption");

  assert.match(sql, /status in \('pending', 'leased'\)[\s\S]*jsonb_build_object\('status', 'duplicate'\)/i);
  assert.match(sql, /set[\s\S]*status = 'pending'[\s\S]*requested_at = now\(\)[\s\S]*completed_at = null/i);
  assert.match(sql, /jsonb_build_object\('status', 'queued'\)/i);
});

test("declares the five service-role-only RPC contracts", () => {
  assert.match(sql, /function public\.enqueue_public_collection_request\([\s\S]*returns jsonb/i);
  assert.match(sql, /function public\.claim_oldest_public_collection_request\([\s\S]*returns table \([\s\S]*request_id uuid,[\s\S]*shop_id text,[\s\S]*external_product_id text,[\s\S]*product_url text,[\s\S]*lease_until timestamptz/i);
  assert.match(sql, /function public\.release_public_collection_request\([\s\S]*returns void/i);
  assert.match(sql, /function public\.complete_public_collection_request\([\s\S]*returns void/i);
  assert.match(sql, /function public\.public_collection_queue_pending_count\(\)[\s\S]*returns bigint/i);

  const signatures = [
    "enqueue_public_collection_request(text,text,text,text,date)",
    "claim_oldest_public_collection_request(text[],timestamptz)",
    "release_public_collection_request(uuid,timestamptz)",
    "complete_public_collection_request(text,text,text)",
    "public_collection_queue_pending_count()",
  ];

  for (const signature of signatures) {
    const escaped = signature.replace(/[()[\]]/g, "\\$&");
    assert.match(sql, new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${escaped} to service_role`, "i"));
  }
});

test("claims with an exclusive lease and makes expired or released work claimable", () => {
  assert.match(sql, /where status = 'pending'\s+and \(lease_until is null or lease_until < now\(\)\)\s+and request_id::text <> all\(coalesce\(p_excluded_request_ids, '\{\}'::text\[\]\)\)\s+order by requested_at asc\s+limit 1\s+for update skip locked/i);
  assert.match(sql, /set[\s\S]*status = 'leased'[\s\S]*lease_until = p_lease_until[\s\S]*attempt_count = .*attempt_count \+ 1/i);
  assert.match(sql, /update public\.public_collection_requests[\s\S]*set status = 'pending'[\s\S]*where status = 'leased'[\s\S]*lease_until < now\(\)/i);
  assert.match(sql, /function public\.release_public_collection_request[\s\S]*status = 'pending'[\s\S]*lease_until = null/i);
  assert.match(
    sql,
    /function public\.release_public_collection_request\(\s*p_request_id uuid,\s*p_expected_lease_until timestamptz\s*\)[\s\S]*r\.lease_until = p_expected_lease_until/i,
    "a stale collector must not release a newer collector's lease",
  );
});

test("completes by Shopee identity and counts all outstanding requests", () => {
  assert.match(sql, /function public\.complete_public_collection_request[\s\S]*platform = p_platform[\s\S]*external_shop_id = p_external_shop_id[\s\S]*external_product_id = p_external_product_id/i);
  assert.match(sql, /set[\s\S]*status = 'completed'[\s\S]*lease_until = null[\s\S]*completed_at = now\(\)/i);
  assert.match(sql, /function public\.public_collection_queue_pending_count\(\)[\s\S]*status in \('pending', 'leased'\)/i);
});
