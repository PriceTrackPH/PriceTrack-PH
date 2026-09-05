import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20260908_midnight_daily_reset.sql",
  import.meta.url,
);

test("an available product is scheduled for the next Manila midnight after success", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /when p_status = 'success' then[\s\S]+p_checked_at at time zone 'Asia\/Manila'[\s\S]+interval '1 day'[\s\S]+at time zone 'Asia\/Manila'/i,
  );
});

test("the migration makes unchecked available products due for the current Manila day", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /update public\.products p[\s\S]+all_variations_sold_out, false\) = false/i);
  assert.match(
    sql,
    /else[\s\S]+date_trunc\('day', now\(\) at time zone 'Asia\/Manila'\)[\s\S]+at time zone 'Asia\/Manila'/i,
  );
});

test("the migration keeps products checked today deferred until tomorrow midnight", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /exists[\s\S]+checked_date = \(now\(\) at time zone 'Asia\/Manila'\)::date[\s\S]+status = 'success'/i);
  assert.match(sql, /date_trunc\('day', now\(\) at time zone 'Asia\/Manila'\) \+ interval '1 day'/i);
});

test("sold-out products retain the 15 then 30-day escalation", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /consecutive_sold_out_checks >= 2[\s\S]+interval '30 days'/i);
  assert.match(sql, /v_all_sold_out[\s\S]+interval '15 days'/i);
});
