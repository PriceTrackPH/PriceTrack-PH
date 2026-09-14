import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("admin histories use realtime broadcasts without polling", async () => {
  const realtime = await readFile(new URL("../src/admin-realtime.ts", import.meta.url), "utf8");
  const collector = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  const scanner = await readFile(new URL("../src/AdminStoreScanner.tsx", import.meta.url), "utf8");
  assert.match(realtime, /broadcast/);
  assert.match(realtime, /admin-history-changed/);
  assert.match(collector, /Another Collector run/);
  assert.match(scanner, /subscribeToAdminHistory/);
  assert.doesNotMatch(realtime, /setInterval/);
});

test("collector, health, and store histories retain 31 days and return 20 rows", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260914_feature_1_history_retention.sql", import.meta.url), "utf8");
  const collectorApi = await readFile(new URL("../api/admin-pc-collector.js", import.meta.url), "utf8");
  const healthApi = await readFile(new URL("../api/admin-health.js", import.meta.url), "utf8");
  assert.match(migration, /interval '31 days'/);
  assert.match(migration, /collector_run_history[\s\S]*store_scan_history[\s\S]*diagnostic_events/);
  assert.match(collectorApi, /limit:\s*"20"/);
  assert.match(healthApi, /limit:\s*"20"/);
});
