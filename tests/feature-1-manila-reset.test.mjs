import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("same-price checks become due at the next Manila midnight", async () => {
  const api = await readFile(new URL("../api/admin-pc-collector.js", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/20260914_feature_1_manila_daily_reset.sql", import.meta.url), "utf8");
  assert.match(api, /\+ 1 \* 24 \* 60 \* 60_000/);
  assert.match(migration, /interval '1 day'[\s\S]*all_variations_unchanged/i);
  assert.doesNotMatch(migration, /interval '2 days'/i);
});

test("active Collector counters reset when the Manila date changes", async () => {
  const page = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(page, /runManilaDate/);
  assert.match(page, /resetDailyRunCounters/);
});
