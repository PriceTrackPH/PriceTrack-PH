import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("random claim migration filters sold-out products and leases one random row", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260904_available_variation_claim.sql", import.meta.url), "utf8");
  assert.match(sql, /coalesce\(p\.all_variations_sold_out, false\) = false/i);
  assert.match(sql, /order by random\(\)/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /p\.id <> all\(coalesce\(p_excluded_product_ids/i);
  assert.match(sql, /exists\s*\(\s*select 1\s*from public\.product_variations v\s*where v\.product_id = p\.id\s*and v\.is_active/is);
});
