import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { withCollectorRetry } from "../src/collector-request-policy.js";
import { readCollectorRunCheckpoint, saveCollectorRunCheckpoint } from "../src/collector-run-recovery.ts";
import {
  collectorProductWaitExpired,
  collectorStopGraceExpired,
} from "../src/collector-product-wait-policy.ts";

test("collector retries transient failures and returns the successful response", async () => {
  let attempts = 0;
  const value = await withCollectorRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error("temporary"), { retryable: true });
    return "saved";
  }, { attempts: 3, delays: [0, 0] });
  assert.equal(value, "saved");
  assert.equal(attempts, 3);
});

test("collector does not retry a permanent authentication failure", async () => {
  let attempts = 0;
  await assert.rejects(() => withCollectorRetry(async () => {
    attempts += 1;
    throw Object.assign(new Error("expired"), { retryable: false });
  }, { attempts: 3, delays: [0, 0] }), /expired/);
  assert.equal(attempts, 1);
});

test("pending finalization checkpoint preserves its intended stop status", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const checkpoint = {
    runId: crypto.randomUUID(), startedAt: new Date().toISOString(), succeeded: 3, failed: 0,
    soldOut: 0, recheckAt: null, samePrice: 0, samePriceRecheckAt: null, remaining: 20,
    phase: "pending_finalization", intendedStopStatus: "stopped_safely",
  };
  saveCollectorRunCheckpoint(storage, checkpoint);
  assert.deepEqual(readCollectorRunCheckpoint(storage), checkpoint);
});

test("checkpoint preserves the active claim and an accurate failure reason", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const checkpoint = {
    runId: crypto.randomUUID(), startedAt: new Date().toISOString(), succeeded: 9, failed: 0,
    soldOut: 0, recheckAt: null, samePrice: 0, samePriceRecheckAt: null, remaining: 20,
    phase: "pending_finalization", intendedStopStatus: "login_expired", failureReason: "login_expired",
    activeProduct: {
      claimSource: "random", queueRequestId: null, productId: 44, shopId: "12",
      externalProductId: "34", productUrl: "https://shopee.ph/item-i.12.34", leaseUntil: new Date().toISOString(),
    },
  };
  saveCollectorRunCheckpoint(storage, checkpoint);
  assert.deepEqual(readCollectorRunCheckpoint(storage), checkpoint);
});

test("Collector retries API requests and finalizes errors instead of leaving a stale run", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /withCollectorRetry/);
  assert.match(source, /checkpointRun\("pending_finalization"/);
  assert.match(source, /await finishRun\("api_failure"\)/);
});

test("Stop waits for the active product and then finalizes safely", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /const stopRequested = useRef\(false\)/);
  assert.match(source, /while \(!stopped\.current && !stopRequested\.current\)/);
  assert.match(source, /if \(stopRequested\.current\) \{[\s\S]*await finishRun\("stopped_safely"\)/);
  assert.match(source, /Stopping after the current product finishes/);
});

test("an unresolved product cannot block collection forever", () => {
  assert.equal(collectorProductWaitExpired(1_000, 120_999), false);
  assert.equal(collectorProductWaitExpired(1_000, 121_000), true);
});

test("Stop gives the current product a bounded confirmation grace period", () => {
  assert.equal(collectorStopGraceExpired(null, 90_000), false);
  assert.equal(collectorStopGraceExpired(60_000, 89_999), false);
  assert.equal(collectorStopGraceExpired(60_000, 90_000), true);
});

test("timed-out confirmation is failed, released, checkpointed, and can stop safely", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /const stopRequestedAt = useRef<number \| null>\(null\)/);
  assert.match(source, /collectorProductWaitExpired\(productWaitStartedAt, Date\.now\(\)\)/);
  assert.match(source, /collectorStopGraceExpired\(stopRequestedAt\.current, Date\.now\(\)\)/);
  assert.match(source, /await releaseCurrent\(\);[\s\S]*failedCount\.current \+= 1;[\s\S]*checkpointRun\(\)/);
  assert.match(source, /stopRequestedAt\.current = Date\.now\(\)/);
});

test("reload reconciles the checkpointed active product before finalizing", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /async function recoverCollectorCheckpoint/);
  assert.match(source, /checkpoint\.activeProduct[\s\S]*api<[^>]+>\("status"/);
  assert.match(source, /recovered\.succeeded \+= 1/);
  assert.match(source, /await api\("release"/);
  assert.match(source, /await api\("finish"/);
});

test("401 saves login-expired recovery state before redirecting", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /response\.status === 401[\s\S]*checkpointRun\("pending_finalization", "login_expired", "login_expired"\)[\s\S]*window\.location\.replace\("\/admin"\)/);
});

test("run history supports accurate safe failure statuses", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../api/admin-pc-collector.js", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/20260915_feature_8_run_recovery.sql", import.meta.url), "utf8");
  for (const status of ["login_expired", "api_failure", "confirmation_timeout"]) {
    assert.match(source, new RegExp(status));
    assert.match(api, new RegExp(status));
    assert.match(migration, new RegExp(status));
  }
});
