import { test } from "node:test";
import assert from "node:assert/strict";
import { productOwner, collectorProductDatabase } from "../server/product-owner.js";
import { ownedProductHistory } from "../server/product-history.js";
import { searchCatalog } from "../server/product-catalog.js";
import { ownedProductRows } from "../server/owned-product-rows.js";

const env = { PRICETRACK_DATABASE_ROUTING: "1", SUPABASE_URL: "https://db1.example", SUPABASE_SECRET_KEY: "private-one", SUPABASE_DB2_URL: "https://db2.example", SUPABASE_DB2_SECRET_KEY: "private-two" };
const assigned = { database_id: "db2", internal_product_id: 142724, migration_in_progress: false };

test("read-only ownership preserves IDs and never allocates products", async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push([url, options]); return Response.json([assigned]); };
  const owner = await productOwner(env, { shopId: "238345847", productId: "50659961134" }, fetcher);
  assert.equal(owner.owner, "db2");
  assert.equal(owner.id, 142724);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].method, undefined);
  assert.ok(!calls[0][0].includes("/rpc/"));
  const target = await collectorProductDatabase(env, env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { id: 142724 }, fetcher);
  assert.equal(target.url, "https://db2.example");
  assert.equal(new URL(calls[1][0]).searchParams.get("internal_product_id"), "eq.142724");
});

test("missing, migrating, invalid, or unreachable owners cannot become DB1 fallbacks", async () => {
  assert.deepEqual(await productOwner(env, { id: 123 }, async () => Response.json([])), { missing: true });
  for (const response of [Response.json([{ ...assigned, migration_in_progress: true }]), Response.json([{ ...assigned, database_id: "db6" }]), new Response("", { status: 503 })]) {
    await assert.rejects(productOwner(env, { id: 123 }, async () => response));
  }
  await assert.rejects(productOwner(env, { id: "1&database_id=eq.db1" }, () => { throw Error("Must not fetch"); }), /Invalid saved product/);
  assert.equal(await productOwner({}, { id: 1 }, () => { throw Error("Must not fetch"); }), null);
});

test("a moved report loads complete paginated history without querying DB1 product rows", async () => {
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    if (url.includes("product_database_directory")) return Response.json([assigned]);
    assert.ok(url.startsWith("https://db2.example/"));
    if (url.includes("/products?")) return Response.json([{ id: 142724, name: "Eden" }]);
    if (url.includes("/product_variations?")) return Response.json([{ id: 17, external_variation_id: "default" }, { id: 18, external_variation_id: "123" }]);
    const offset = Number(new URL(url).searchParams.get("offset"));
    return Response.json(offset === 0 ? Array.from({ length: 500 }, (_, id) => ({ id, variation_id: 18 })) : [{ id: 500, variation_id: 18 }]);
  };
  const result = await ownedProductHistory(env, "238345847", "50659961134", fetcher);
  assert.equal(result.product.id, 142724);
  assert.equal(result.variations.length, 1);
  assert.equal(result.observations.length, 501);
  assert.equal(calls.length, 5);
});

test("search uses owner data once and fails if that owner is unavailable", async () => {
  const row = { id: 142724, name: "Eden", external_shop_id: "238345847", external_product_id: "50659961134" };
  const fetcher = async url => Response.json(url.includes("product_database_directory") ? [assigned] : [{ ...row, name: url.startsWith(env.SUPABASE_DB2_URL) ? "Eden fresh" : "Eden stale" }]);
  const results = await searchCatalog(env, { nameFilter: "ilike.%Eden%", limit: 5 }, fetcher);
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "Eden fresh");
  await assert.rejects(searchCatalog(env, { nameFilter: "ilike.%Eden%" }, async url => url.startsWith(env.SUPABASE_DB2_URL) ? new Response("", { status: 503 }) : fetcher(url)), /assigned product database/);
});

test("community lease updates retain atomic conditions and use only the owner's credentials", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    if (url.includes("product_database_directory")) return Response.json([assigned]);
    calls.push([new URL(url), options]);
    return Response.json([{ id: 142724 }]);
  };
  const path = "products?id=eq.142724&check_lease_until=eq.2026-11-27T13%3A00%3A00Z&and=(or(last_checked_at.is.null,last_checked_at.lt.2026-11-27T00%3A00%3A00Z))";
  const result = await ownedProductRows(env, path, { method: "PATCH", headers: { Authorization: "Bearer OLD-DB1-CREDENTIAL", Prefer: "return=representation" }, body: JSON.stringify({ check_lease_until: null }) }, fetcher);
  assert.deepEqual(result, [{ id: 142724 }]);
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url.origin, env.SUPABASE_DB2_URL);
  assert.equal(url.searchParams.get("check_lease_until"), "eq.2026-11-27T13:00:00Z");
  assert.equal(url.searchParams.get("and"), new URLSearchParams(path.split("?")[1]).get("and"));
  assert.equal(options.headers.get("apikey"), "private-two");
  assert.equal(options.headers.get("authorization"), null);
  assert.equal(options.headers.get("prefer"), "return=representation");
  await assert.rejects(ownedProductRows(env, "products?select=*", {}, fetcher), /saved product filter/);
});
