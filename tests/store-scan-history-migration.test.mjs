import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

const migrations = await readdir(new URL("../supabase/migrations/", import.meta.url));
const matches = migrations.filter((name) => name.endsWith("_design_q_store_scan_history.sql"));

test("Design Q has one reproducible store scan history migration", () => {
  assert.equal(matches.length, 1);
});

test("store scan history is private and records complete scan totals", async () => {
  assert.equal(matches.length, 1);
  const sql = await readFile(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), "utf8");
  assert.match(sql, /create table public\.store_scan_history/i);
  assert.match(sql, /scan_id uuid primary key/i);
  assert.match(sql, /status text not null[\s\S]*completed[\s\S]*incomplete[\s\S]*interrupted/i);
  assert.match(sql, /sold_out integer not null default 0/i);
  assert.match(sql, /pages_current integer not null default 0/i);
  assert.match(sql, /pages_total integer not null default 0/i);
  assert.match(sql, /alter table public\.store_scan_history enable row level security/i);
  assert.match(sql, /revoke all on table public\.store_scan_history from public, anon, authenticated/i);
});

test("sold-out store requests wait fifteen days before normal collection", async () => {
  assert.equal(matches.length, 1);
  const sql = await readFile(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), "utf8");
  assert.match(sql, /discovered_sold_out boolean not null default false/i);
  assert.match(sql, /eligible_at timestamptz not null default now\(\)/i);
  assert.match(sql, /interval '15 days'/i);
  assert.match(sql, /eligible_at <= now\(\)/i);
  assert.match(sql, /store_collection_queue_pending_count\(\)[\s\S]*eligible_at <= now\(\)/i);
  assert.match(sql, /if not v_sold_out then[\s\S]*v_newly_queued := v_newly_queued \+ 1/i);
});

test("scan functions persist sold-out and page progress without public execution", async () => {
  assert.equal(matches.length, 1);
  const sql = await readFile(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), "utf8");
  assert.match(sql, /import_store_collection_batch\([\s\S]*p_pages_current integer[\s\S]*p_pages_total integer/i);
  assert.match(sql, /last_sold_out/i);
  assert.match(sql, /last_pages_current/i);
  assert.match(sql, /last_pages_total/i);
  assert.match(sql, /revoke all on function public\.import_store_collection_batch\(uuid,jsonb,integer,integer\) from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.finish_store_collection_scan\(uuid,text,integer,integer\) from public, anon, authenticated/i);
  assert.match(sql, /create or replace function public\.import_store_collection_batch\(p_scan_id uuid, p_products jsonb\)[\s\S]*import_store_collection_batch\(p_scan_id, p_products, 0, 0\)/i);
});

test("REST exposes only the four-argument store scan RPC signatures", async () => {
  const cleanup = migrations.filter((name) => name.endsWith("_remove_store_scan_rpc_overloads.sql"));
  assert.equal(cleanup.length, 1);
  const sql = await readFile(new URL(`../supabase/migrations/${cleanup[0]}`, import.meta.url), "utf8");

  assert.match(sql, /drop function if exists public\.import_store_collection_batch\(uuid, jsonb\)/i);
  assert.match(sql, /drop function if exists public\.finish_store_collection_scan\(uuid, text\)/i);
  assert.match(sql, /notify pgrst, 'reload schema'/i);
});
