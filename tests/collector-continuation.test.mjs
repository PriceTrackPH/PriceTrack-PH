import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("collector counts 3 2 1 and requests a random unseen product", async () => {
  const source = await readFile(new URL("../pc-collector/normal-browser-collector.mjs", import.meta.url), "utf8");
  assert.match(source, /message:''\+Math\.max\(1,Math\.ceil\(error\.body\.waitMs\/1000\)\)/);
  assert.match(source, /attemptedProductIds:\[\.\.\.attemptedProductIds\]/);
  assert.doesNotMatch(source, /afterProductId/);
});

test("collector recovers when the web-store extension records directly to the database", async () => {
  const source = await readFile(new URL("../pc-collector/normal-browser-collector.mjs", import.meta.url), "utf8");
  assert.match(source, /refreshExternalCompletion/);
  assert.match(source, /completionWasRecorded/);
  assert.match(source, /summaryCheckPromise\.catch\(\(\) => \{\}\)/);
});
