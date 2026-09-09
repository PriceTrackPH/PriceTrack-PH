import assert from "node:assert/strict";
import test from "node:test";

import {
  includeStoreImportsDefault,
  normalizeDiscoveredProducts,
  normalizeShopeeStoreUrl,
} from "../src/store-import-contract.ts";

test("normalizes one public Shopee store path and removes listing fragments", () => {
  assert.deepEqual(normalizeShopeeStoreUrl("https://shopee.ph/JabraOfficialStore/#product_list"), {
    storeKey: "jabraofficialstore",
    storeUrl: "https://shopee.ph/jabraofficialstore",
    displayName: "JabraOfficialStore",
  });
});

test("rejects product pages, nested paths, credentials, and non-Shopee hosts", () => {
  for (const value of [
    "https://shopee.ph/item-i.12.34",
    "https://shopee.ph/product/12/34",
    "https://shopee.ph/store/category",
    "https://user:pass@shopee.ph/store",
    "https://seller.shopee.ph/store",
    "https://evil.example/store",
  ]) assert.equal(normalizeShopeeStoreUrl(value), null, value);
});

test("deduplicates numeric product identities and produces canonical Shopee URLs", () => {
  assert.deepEqual(normalizeDiscoveredProducts([
    { shopId: "1297824816", externalProductId: "26621066471" },
    { shopId: 1297824816, productId: 26621066471 },
    { shopId: "282024671", productId: "19463132448" },
    { shopId: "bad", productId: "1" },
    { shopId: "1", productId: "0" },
  ]), [
    {
      shopId: "1297824816",
      externalProductId: "26621066471",
      productUrl: "https://shopee.ph/product/1297824816/26621066471",
      soldOut: false,
    },
    {
      shopId: "282024671",
      externalProductId: "19463132448",
      productUrl: "https://shopee.ph/product/282024671/19463132448",
      soldOut: false,
    },
  ]);
});

test("preserves sold-out classification and merges duplicate identities safely", () => {
  assert.deepEqual(normalizeDiscoveredProducts([
    { shopId: "12", productId: "34", soldOut: false },
    { shopId: "12", productId: "34", soldOut: true },
    { shopId: "56", productId: "78" },
    { shopId: "90", productId: "12", soldOut: "true" },
  ]), [
    {
      shopId: "12",
      externalProductId: "34",
      productUrl: "https://shopee.ph/product/12/34",
      soldOut: true,
    },
    {
      shopId: "56",
      externalProductId: "78",
      productUrl: "https://shopee.ph/product/56/78",
      soldOut: false,
    },
    {
      shopId: "90",
      externalProductId: "12",
      productUrl: "https://shopee.ph/product/90/12",
      soldOut: false,
    },
  ]);
});

test("caps one scan without allowing a caller to exceed the global maximum", () => {
  const values = Array.from({ length: 12 }, (_, index) => ({ shopId: "7", productId: String(index + 1) }));
  assert.equal(normalizeDiscoveredProducts(values, 3).length, 3);
  assert.equal(normalizeDiscoveredProducts(values, 99_999).length, 12);
});

test("includes store imports by default and remembers an explicit off choice", () => {
  assert.equal(includeStoreImportsDefault(null), true);
  assert.equal(includeStoreImportsDefault("true"), true);
  assert.equal(includeStoreImportsDefault("false"), false);
  assert.equal(includeStoreImportsDefault("corrupt"), true);
});
