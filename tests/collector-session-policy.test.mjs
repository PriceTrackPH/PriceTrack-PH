import assert from "node:assert/strict";
import test from "node:test";

import {
  cooldownEndAfterLimit,
  cooldownSecondsRemaining,
  reachedCollectionLimit,
} from "../src/collector-session-policy.ts";

test("stops a collection when its fiftieth product succeeds", () => {
  assert.equal(reachedCollectionLimit(49), false);
  assert.equal(reachedCollectionLimit(50), true);
  assert.equal(reachedCollectionLimit(51), true);
});

test("locks manual collection for one hour after reaching the limit", () => {
  const stoppedAt = Date.parse("2026-09-05T06:00:00.000Z");
  const cooldownEnd = cooldownEndAfterLimit(stoppedAt);

  assert.equal(cooldownEnd, Date.parse("2026-09-05T07:00:00.000Z"));
  assert.equal(cooldownSecondsRemaining(cooldownEnd, stoppedAt), 3600);
  assert.equal(cooldownSecondsRemaining(cooldownEnd, stoppedAt + 3_599_001), 1);
  assert.equal(cooldownSecondsRemaining(cooldownEnd, cooldownEnd), 0);
});
