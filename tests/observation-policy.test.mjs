import test from "node:test";
import assert from "node:assert/strict";

import {
  allVariationsSoldOut,
  buildCheckMetadata,
  shouldSkipObservation,
} from "../supabase/functions/record-price/observation-policy.ts";

const unchangedItem = {
  price: 147,
  originalPrice: null,
  isInStock: true,
};

test("skips an unchanged observation already recorded on the same Manila day", () => {
  const latest = {
    price: 147,
    original_price: null,
    is_in_stock: true,
    observed_at: "2026-09-01T01:00:00.000Z",
  };

  assert.equal(shouldSkipObservation(latest, unchangedItem, "2026-09-01"), true);
});

test("records an unchanged observation on a new Manila day", () => {
  const latest = {
    price: 147,
    original_price: null,
    is_in_stock: true,
    observed_at: "2026-08-29T05:00:00.000Z",
  };

  assert.equal(shouldSkipObservation(latest, unchangedItem, "2026-09-01"), false);
});

test("uses Manila rather than UTC at the calendar-day boundary", () => {
  const latest = {
    price: 147,
    original_price: null,
    is_in_stock: true,
    observed_at: "2026-08-31T16:30:00.000Z",
  };

  assert.equal(shouldSkipObservation(latest, unchangedItem, "2026-09-01"), true);
});

test("records a changed price even on the same Manila day", () => {
  const latest = {
    price: 146,
    original_price: null,
    is_in_stock: true,
    observed_at: "2026-09-01T01:00:00.000Z",
  };

  assert.equal(shouldSkipObservation(latest, unchangedItem, "2026-09-01"), false);
});

test("marks a product sold out only when every variation is unavailable", () => {
  assert.equal(allVariationsSoldOut([{ isInStock: false }, { isInStock: false }]), true);
  assert.equal(allVariationsSoldOut([{ isInStock: false }, { isInStock: true }]), false);
  assert.equal(allVariationsSoldOut([]), false);
});

test("includes the fully sold-out result in completed-check metadata", () => {
  assert.deepEqual(
    buildCheckMetadata(
      [{ isInStock: false }, { isInStock: false }],
      true,
    ),
    {
      collector_format: "bulk_models_v1",
      all_variations_sold_out: true,
    },
  );
});
