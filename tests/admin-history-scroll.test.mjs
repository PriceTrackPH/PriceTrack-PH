import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("admin history tables use one 20-row scroll area without pagination controls", async () => {
  const [collector, scanner, health, css] = await Promise.all([
    read("src/AdminCollector.tsx"),
    read("src/AdminStoreScanner.tsx"),
    read("src/AdminHealth.tsx"),
    read("src/precision-fix.css"),
  ]);

  assert.match(collector, /health-table-wrap admin-history-scroll/);
  assert.match(scanner, /health-table-wrap admin-history-scroll/);
  assert.match(health, /health-table-wrap admin-history-scroll/);
  assert.doesNotMatch(scanner, /store-scan-pagination|>Previous<|>Next</);
  assert.match(css, /\.admin-history-scroll\s*\{[^}]*--visible-history-rows:\s*20;[^}]*overflow-y:\s*auto;/s);
});

test("history APIs keep one newest-20 list without a second page", async () => {
  const collectorApi = await read("api/admin-pc-collector.js");

  assert.match(collectorApi, /limit:\s*"20"/);
  assert.doesNotMatch(collectorApi, /offset:\s*String\(\(page - 1\) \* pageSize\)/);
});
