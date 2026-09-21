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

test("Collector status documents the 30-day unavailable schedule", () => {
  assert.match(source, /Doesn(?:.?t|&apos;t) exist[\s\S]*30 days[\s\S]*30 days[\s\S]*30 days/i);
  assert.match(source, /Unlisted[\s\S]*30 days[\s\S]*30 days[\s\S]*30 days/i);
});
