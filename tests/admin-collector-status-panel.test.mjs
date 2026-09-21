import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");

test("Collector status uses the requested lavender metric cards", () => {
  assert.match(source, /admin-collector-status-grid/);
  for (const label of ["Total products", "Total available", "Total Sold out", "total Same price", "total Priority queue", "total Store queue", "Remaining", "Processing", "Succeeded", "Failed"]) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("Collector status uses the approved two-row card layout", () => {
  assert.match(source, /gridTemplateColumns:\s*"repeat\(6, minmax\(0, 1fr\)\)"/);
  assert.match(source, /admin-collector-status-message[\s\S]*gridColumn:\s*"3 \/ span 2"/);
  assert.match(source, /linear-gradient\(to bottom, rgba\(230, 230, 250, 0\.5\) 0%, #e6e6fa 100%\)/i);
});

test("Collector status omits the unavailable scheduling note", () => {
  assert.doesNotMatch(source, /admin-collector-unavailable-schedule/);
  assert.doesNotMatch(source, /Doesn(?:.?t|&apos;t) exist[\s\S]*30 days/i);
});
