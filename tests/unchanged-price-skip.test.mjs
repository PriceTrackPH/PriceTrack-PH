import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { variationStatesMatchPrevious } from "../supabase/functions/record-price/observation-policy.ts";

test("unchanged scheduling requires every current variation to match the previous state", () => {
  const previous = new Map([
    [11, { price: 100, original_price: 120, is_in_stock: true, observed_at: "2026-09-06T02:00:00.000Z" }],
    [12, { price: 150, original_price: null, is_in_stock: true, observed_at: "2026-09-06T02:00:00.000Z" }],
  ]);
  const rows = new Map([["a", { id: 11 }], ["b", { id: 12 }]]);
  const current = [
    { variationId: "a", price: 100, originalPrice: 120, isInStock: true },
    { variationId: "b", price: 150, originalPrice: null, isInStock: true },
  ];

  assert.equal(variationStatesMatchPrevious(current, rows, previous), true);
  assert.equal(variationStatesMatchPrevious([{ ...current[0], price: 99 }, current[1]], rows, previous), false);
  assert.equal(variationStatesMatchPrevious(current.slice(0, 1), rows, previous), false);
});

test("collector toggle is on by default, remembered, and sent with every recorded product", async () => {
  const source = await readFile(new URL("../pc-collector/normal-browser-collector.mjs", import.meta.url), "utf8");

  assert.match(source, /Skip next day when price is unchanged/);
  assert.match(source, /localStorage\.getItem\(["']ptphSkipUnchangedDay["']\) !== ["']false["']/);
  assert.match(source, /localStorage\.setItem\(["']ptphSkipUnchangedDay["']/);
  assert.match(source, /skipUnchangedDay:\s*skipToggle\.checked/);
  assert.match(source, /payload:\s*\{\s*\.\.\.observation,\s*skipUnchangedDay:\s*state\.skipUnchangedDay\s*\}/s);
});

test("record-price marks a fully unchanged collector result for optional scheduling", async () => {
  const source = await readFile(new URL("../supabase/functions/record-price/index.ts", import.meta.url), "utf8");

  assert.match(source, /skip_unchanged_day:\s*body\.skipUnchangedDay === true/);
  assert.match(source, /all_variations_unchanged:\s*variationStatesMatchPrevious/);
});

test("database skips exactly one Manila calendar day only when the option is enabled and all states are unchanged", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260910_unchanged_price_skip.sql", import.meta.url), "utf8");

  assert.doesNotMatch(sql, /\\n/);
  assert.match(sql, /p_metadata\s*->>\s*'skip_unchanged_day'/i);
  assert.match(sql, /p_metadata\s*->>\s*'all_variations_unchanged'/i);
  assert.match(sql, /interval '2 days'/i);
  assert.match(sql, /interval '1 day'/i);
  assert.match(sql, /consecutive_sold_out_checks >= 2[\s\S]+interval '30 days'/i);
  assert.match(sql, /v_all_sold_out[\s\S]+interval '15 days'/i);
});
