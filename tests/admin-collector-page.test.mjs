import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import {
  includeStoreImportsDefault,
  normalizeShopeeStoreUrl,
} from "../src/store-import-contract.ts";
import {
  productUrlWithCollectorOptions,
  productUrlWithSkipUnchangedDay,
  skipSoldOutDefault,
  skipUnchangedDayDefault,
} from "../src/admin-collector-settings.ts";
import { clearCollectorRunCheckpoint, readCollectorRunCheckpoint, saveCollectorRunCheckpoint } from "../src/collector-run-recovery.ts";

test("admin collector scans, saves, and rechecks Shopee stores without auto-starting collection", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.deepEqual(normalizeShopeeStoreUrl("https://shopee.ph/JabraOfficialStore#product_list"), {
    storeKey: "jabraofficialstore", storeUrl: "https://shopee.ph/jabraofficialstore", displayName: "JabraOfficialStore",
  });
  assert.match(source, /placeholder="Paste a Shopee store link"/);
  assert.match(source, /"Scan store"/);
  assert.match(source, />Saved stores</);
  assert.match(source, />Recheck</);
  assert.match(source, /storeApi<[^;]+>\("begin"/);
  assert.match(source, /storeApi<[^;]+>\("batch"/);
  assert.match(source, /failed \? "fail" : "finish"/);
  assert.match(source, /STORE_SCAN_PAGE_SOURCE/);
  assert.doesNotMatch(source, /await startCollection\(\)[\s\S]{0,200}Scan store/);
});

test("store imports participate in normal runs only when the default-on toggle is enabled", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.equal(includeStoreImportsDefault(null), true);
  assert.equal(includeStoreImportsDefault("false"), false);
  assert.match(source, /Include store-imported products/);
  assert.match(source, /localStorage\.setItem\(includeStoreImportsStorageKey, String\(nextValue\)\)/);
  assert.match(source, /includeStoreImports:\s*includeStoreImports/);
  assert.match(source, /attemptedStoreRequestIds/);
  assert.match(source, /Store queue pending: \{summary\?\.storeQueuePending \?\? "—"\}/);
});

test("routes the protected collector admin page", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const sections = await readFile(new URL("../src/SiteSections.tsx", import.meta.url), "utf8");
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.match(app, /pathname === "\/admin\/collector"/);
  assert.match(app, /<AdminCollector/);
  assert.match(sections, /"\/admin\/collector"/);
  assert.ok(vercel.rewrites.some((rewrite) => rewrite.source === "/admin/collector" && rewrite.destination === "/"));
});

test("admin collector reuses one product tab and waits one second after recording", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /window\.open\("about:blank", "ptph-admin-collector"\)/);
  assert.match(source, /consecutiveFailures = 0;/);
  assert.match(source, /reachedCollectionLimit\(succeededCount\.current\)/);
  assert.match(source, /await finishRun\("stopped_safely"\)/);
  assert.match(source, /await wait\(1_000\);/);
  assert.match(source, /disabled=\{running \|\| cooldownSeconds > 0 \|\| !summary\}/);
  assert.doesNotMatch(source, /setMessage\(String\(Math\.max/);
  assert.match(source, /Start collection/);
  assert.match(source, /Stop collection/);
});

test("unlimited collection bypasses cooldown and the 50-product cap while unresolved products stay pinned", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /Start unlimited collection/);
  assert.match(source, /collectionMode\.current === "normal" && reachedCollectionLimit/);
  assert.match(source, /if \(mode === "normal" && cooldownSeconds > 0\) return/);
  assert.match(source, /while \(!stopped\.current\) \{/);
  assert.doesNotMatch(source, /Date\.now\(\) < deadline|75_000/);
});

test("collector options carry independent default-on sold-out deferral", () => {
  assert.equal(skipSoldOutDefault(null), true);
  assert.equal(skipSoldOutDefault("false"), false);
  const url = productUrlWithCollectorOptions("https://shopee.ph/item-i.12.34", false, false);
  assert.match(url, /ptph_skip_unchanged=0/);
  assert.match(url, /ptph_skip_sold_out=0/);
});

test("active collector checkpoints validate and clear safely", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const checkpoint = { runId: crypto.randomUUID(), startedAt: new Date().toISOString(), succeeded: 3, failed: 1, soldOut: 1, recheckAt: null, samePrice: 2, samePriceRecheckAt: null, remaining: 20 };
  saveCollectorRunCheckpoint(storage, checkpoint);
  assert.deepEqual(readCollectorRunCheckpoint(storage), checkpoint);
  clearCollectorRunCheckpoint(storage);
  assert.equal(readCollectorRunCheckpoint(storage), null);
});

test("live admin collector remembers the unchanged-price skip toggle and sends it through Shopee", async () => {
  const page = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  const extension = await readFile(new URL("../extension/collector-options.js", import.meta.url), "utf8");
  const recorder = await readFile(new URL("../supabase/functions/record-price/index.ts", import.meta.url), "utf8");

  assert.equal(skipUnchangedDayDefault(null), true);
  assert.equal(skipUnchangedDayDefault("true"), true);
  assert.equal(skipUnchangedDayDefault("false"), false);
  assert.equal(
    productUrlWithSkipUnchangedDay("https://shopee.ph/item-i.12.34?x=1", true),
    "https://shopee.ph/item-i.12.34?x=1&ptph_skip_unchanged=1&ptph_skip_sold_out=1",
  );

  const context = vm.createContext({ URL });
  vm.runInContext(extension, context);
  assert.equal(context.PriceTrackCollectorOptions.skipUnchangedDayFromUrl("https://shopee.ph/item?ptph_skip_unchanged=1"), true);
  assert.equal(context.PriceTrackCollectorOptions.skipUnchangedDayFromUrl("https://shopee.ph/item?ptph_skip_unchanged=0"), false);

  assert.match(page, /Skip next day when price is unchanged/);
  assert.match(page, /localStorage\.setItem\(skipUnchangedStorageKey, String\(nextValue\)\)/);
  assert.match(page, /skipUnchangedDay:\s*skipUnchangedDay/);
  assert.match(page, /skipSoldOut:\s*skipSoldOut/);
  assert.match(recorder, /skip_unchanged_day:\s*body\.skipUnchangedDay === true/);
});

test("admin collector polls completion for the exact claimed product", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /api<\{ completed: boolean; soldOut: boolean; recheckAt: string \| null; samePrice: boolean; samePriceRecheckAt: string \| null \}>\("status"/);
  assert.match(source, /productId: product\.productId/);
  assert.match(source, /status\.completed/);
});

test("admin collector processes priority claims and shows only their pending count", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /priorityPending: number/);
  assert.match(source, /Priority queue pending: \{summary\?\.priorityPending \?\? "—"\}/);
  assert.match(source, /attemptedQueueRequestIds/);
  assert.match(source, /claimSource: "priority" \| "store" \| "random"/);
  assert.match(source, /queueRequestId/);
  assert.doesNotMatch(source, /<th>Queued product<\/th>|Queue management|Priority queue history/);
});

test("admin collector saves and displays every stopped run", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /action=\$\{action\}/);
  assert.match(source, /api(?:<[^;]+>)?\("finish"/);
  assert.match(source, /Collection history/);
  assert.match(source, /Running time/);
  assert.match(source, /Remaining/);
  assert.match(source, /saved\.remaining/);
  assert.match(source, /Stopped safely/);
});

test("admin collector saves an empty run when no products are due", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");

  assert.match(
    source,
    /if \(!product\) \{[^}]*setMessage\("No more available due products"\);[^}]*await finishRun\("stopped_safely"\);[^}]*break;/s,
  );
});

test("collection history uses the same boxed table layout as recent events", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/precision-fix.css", import.meta.url), "utf8");
  assert.match(source, /className="health-events admin-collector-history"/);
  assert.match(source, /className="health-table-wrap"/);
  assert.match(source, /<table>/);
  assert.match(styles, /\.admin-collector-history\s*\{[^}]*margin-top:\s*24px;/);
});

test("collector panels remain readable in light mode", async () => {
  const styles = await readFile(new URL("../src/precision-fix.css", import.meta.url), "utf8");
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.admin-collector-panel\s*\{[^}]*background:\s*#fff;[^}]*color:\s*#17201d;/s);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.admin-collector-option\s*\{[^}]*color:\s*#17201d;/s);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.admin-collector-status\s*\{[^}]*background:\s*#f3f6f5;[^}]*color:\s*#17201d;/s);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.admin-saved-stores a\s*\{[^}]*color:\s*#087e68;/s);
});

test("collection history shows the Philippine start date and exact time", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");

  assert.match(source, /<th>Time<\/th>/);
  assert.match(source, /new Date\(run\.startedAt\)\.toLocaleString\("en-US", \{ timeZone: "Asia\/Manila", year: "2-digit", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit" \}\)/);
  assert.doesNotMatch(source, /<th>Stopped<\/th>/);
});

test("collection history combines exclusion counts with their next-check dates", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");

  assert.match(source, /<th>Running time<\/th>/);
  assert.match(source, /<th>Sold out<\/th>/);
  assert.match(source, /<th>Same Price<\/th>/);
  assert.match(source, /<th>Remaining<\/th>/);
  assert.doesNotMatch(source, /<th>Recheck<\/th>/);
  assert.match(source, /run\.soldOut/);
  assert.match(source, /run\.recheckAt/);
  assert.match(source, /run\.samePrice/);
  assert.match(source, /run\.samePriceRecheckAt/);
  assert.match(source, /Same price excluded: \{summary\?\.samePriceDeferred \?\? "—"\}/);
  assert.doesNotMatch(source, /<th>Total running time<\/th>/);
  assert.doesNotMatch(source, /<th>Products remaining<\/th>/);
});
