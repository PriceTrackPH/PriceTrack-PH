import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20260907_sold_out_escalating_schedule.sql",
  import.meta.url,
);

test("sold-out checks use 15 days twice and 30 days from the third consecutive result", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /consecutive_sold_out_checks integer not null default 0/i);
  assert.match(sql, /consecutive_sold_out_checks >= 2[\s\S]+interval '30 days'/i);
  assert.match(sql, /v_all_sold_out[\s\S]+interval '15 days'/i);
});

test("an in-stock success resets the consecutive sold-out counter", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /consecutive_sold_out_checks = case[\s\S]+when p_status = 'success' and not v_all_sold_out then 0/i,
  );
});

test("existing sold-out products begin with one confirmed sold-out result", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /set consecutive_sold_out_checks = 1[\s\S]+all_variations_sold_out is true/i,
  );
});

test("another successful recording on the same day does not advance the sold-out count", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /v_already_successful_today boolean/i);
  assert.match(
    sql,
    /when p_status = 'success' and v_all_sold_out and not v_already_successful_today[\s\S]+consecutive_sold_out_checks \+ 1/i,
  );
});
