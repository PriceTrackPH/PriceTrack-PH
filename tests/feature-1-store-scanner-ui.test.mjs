import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Store Scanner clears its URL only after a completed scan", async () => {
  const source = await readFile(new URL("../src/AdminStoreScanner.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(finalStatus === "completed"\) setStoreUrl\(""\)/);
});

test("Store Scanner keeps Pages scanned and removes Current page", async () => {
  const source = await readFile(new URL("../src/AdminStoreScanner.tsx", import.meta.url), "utf8");
  assert.match(source, /<span>Pages scanned<strong>/);
  assert.doesNotMatch(source, /<span>Current page<strong>/);
});

test("Unlimited mode omits the post-product delay", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(collectionMode\.current === "normal"\) await wait\(1_000\)/);
});

test("approved purple is scoped to Collector action buttons", async () => {
  const css = await readFile(new URL("../src/precision-fix.css", import.meta.url), "utf8");
  assert.match(css, /\.admin-collector-actions button[^}]*background:\s*#281b6b/i);
  assert.match(css, /\.admin-collector-actions button:disabled[^}]*opacity:\s*\.5/i);
  assert.doesNotMatch(css, /\.admin-store-import-form button[^}]*background:\s*#281b6b/i);
});
