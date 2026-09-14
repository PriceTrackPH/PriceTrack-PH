import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Collector pauses and sounds one alert for Shopee verification", async () => {
  const page = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(page, /verificationAlertedFor/);
  assert.match(page, /AudioContext/);
  assert.match(page, /Shopee verification required/);
  assert.match(page, /data\.outcome === "verification"/);
});
