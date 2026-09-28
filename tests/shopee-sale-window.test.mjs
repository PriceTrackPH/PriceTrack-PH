import assert from "node:assert/strict";
import test from "node:test";
import { isShopeeSaleWindow, skipNextDayForUnchangedPrice } from "../server/shopee-sale-window.js";

test("keeps every promotion day and the day before it eligible for a next-day check", () => {
  for (const day of [
    "2026-09-29", "2026-09-30", "2026-10-01",
    "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11",
    "2026-11-10", "2026-11-11", "2026-11-12",
    "2026-12-11", "2026-12-12", "2026-12-13",
    "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16",
    "2026-12-31", "2027-01-01", "2027-01-02",
    "2027-02-28", "2027-03-01",
  ]) assert.equal(skipNextDayForUnchangedPrice(day), false, day);

  assert.equal(isShopeeSaleWindow("2026-10-09"), true);
  assert.equal(isShopeeSaleWindow("2026-10-08"), false);
  assert.equal(skipNextDayForUnchangedPrice("2026-09-26"), true);
  assert.equal(skipNextDayForUnchangedPrice("2026-09-28"), true);
  assert.equal(skipNextDayForUnchangedPrice("2026-10-17"), true);
});
