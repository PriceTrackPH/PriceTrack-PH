import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { formatPageProgress, nextUnscannedStore, runningTimeLabel } from "../src/store-scan-ui.ts";

test("formats page progress and running time from persisted scan values", () => {
  assert.equal(formatPageProgress(4, 4), "4/4");
  assert.equal(formatPageProgress(3, 0), "3");
  assert.equal(formatPageProgress(0, 0), "—");
  assert.equal(runningTimeLabel("2026-09-09T00:00:00Z", "2026-09-09T01:02:03Z"), "1h 2m 3s");
});

test("recheck all selects saved stores sequentially", () => {
  const stores = [
    { id: "a", storeUrl: "https://shopee.ph/a" },
    { id: "b", storeUrl: "https://shopee.ph/b" },
  ];
  assert.deepEqual(nextUnscannedStore(stores, new Set()), stores[0]);
  assert.deepEqual(nextUnscannedStore(stores, new Set(["a"])), stores[1]);
  assert.equal(nextUnscannedStore(stores, new Set(["a", "b"])), null);
});

test("routes the importer to a dedicated private Store Scanner page", async () => {
  const [app, collector, scanner, sections, vercelText] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/AdminStoreScanner.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/SiteSections.tsx", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);
  const vercel = JSON.parse(vercelText);
  assert.match(app, /pathname === "\/admin\/store-scanner"/);
  assert.match(app, /<AdminStoreScanner/);
  assert.doesNotMatch(collector, /Import a Shopee store|Saved stores|startStoreScan/);
  assert.match(scanner, />Shopee Store Scanner</);
  assert.match(scanner, />Store Scan History</);
  assert.match(scanner, /Recheck all stores/);
  assert.match(scanner, /Found/);
  assert.match(scanner, /Sold Out/);
  assert.match(sections, /"\/admin\/store-scanner"/);
  assert.ok(vercel.rewrites.some((rewrite) => rewrite.source === "/admin/store-scanner" && rewrite.destination === "/"));
});

test("Store Scan History keeps store links plain while preserving navigation", async () => {
  const scanner = await readFile(new URL("../src/AdminStoreScanner.tsx", import.meta.url), "utf8");
  assert.match(scanner, /className="store-scan-store-link"/);
  assert.match(scanner, /target="_blank"/);
  assert.match(scanner, /20/);
  assert.match(scanner, /completed/);
  assert.match(scanner, /incomplete/);
  assert.match(scanner, /interrupted/);
});
