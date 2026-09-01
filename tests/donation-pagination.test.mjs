import test from "node:test";
import assert from "node:assert/strict";

import { donationPageIndex } from "../src/donation-pagination.ts";

test("reports the left, middle, and right QR positions", () => {
  assert.equal(donationPageIndex(0, 320, 3), 0);
  assert.equal(donationPageIndex(332, 320, 3), 1);
  assert.equal(donationPageIndex(664, 320, 3), 2);
});

test("keeps the QR position inside the available dots", () => {
  assert.equal(donationPageIndex(-20, 320, 3), 0);
  assert.equal(donationPageIndex(1200, 320, 3), 2);
  assert.equal(donationPageIndex(50, 0, 3), 0);
});
