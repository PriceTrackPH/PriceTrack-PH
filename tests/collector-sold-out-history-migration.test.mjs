import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("collector history stores sold-out totals and nullable recheck timestamps", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260906_collector_sold_out_history.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /add column if not exists sold_out integer not null default 0/i);
  assert.match(sql, /add column if not exists recheck_at timestamptz/i);
});
