import { test } from "node:test";
import assert from "node:assert/strict";
import observations from "../api/observations.js";
import history from "../api/db2-pilot-history.js";

const env = {
  VERCEL_ENV: "preview", PRICETRACK_DB2_PILOT: "1",
  PRICETRACK_DB2_PRODUCTS: "123:456",
  VITE_SUPABASE_URL: "https://db1.example", VITE_SUPABASE_PUBLISHABLE_KEY: "db1-key",
  SUPABASE_DB2_URL: "https://db2.example", SUPABASE_DB2_SECRET_KEY: "db2-secret",
  SUPABASE_DB2_PUBLISHABLE_KEY: "eyJ-db2-public",
};
function response() {
  return { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, send(body) { return this.json(body); } };
}
test("pilot reads and writes target DB2, other writes and production stay on DB1", async t => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(env)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push([url, options]);
    const result = url.includes("/products?") ? [{ id: 1 }] :
      url.includes("/product_variations?") ? [{ id: 2, external_variation_id: "1" }] :
      url.includes("/price_observations?") ? [{ id: 3, variation_id: 2, price: 99 }] : {};
    return Response.json(result);
  });
  const result = response();
  await history({ method: "GET", query: { shopId: "123", productId: "456" } }, result);
  assert.equal(result.code, 200);
  assert.equal(result.body.observations[0].price, 99);
  assert.ok(calls.every(([url, options]) => url.startsWith(env.SUPABASE_DB2_URL) && options.headers.apikey === "db2-secret"));
  for (const [productId, mode, target] of [["456", "preview", "db2"], ["999", "preview", "db1"], ["456", "production", "db1"]]) {
    process.env.VERCEL_ENV = mode;
    const res = response();
    await observations({ method: "POST", body: { shopId: "123", productId } }, res);
    assert.equal(res.code, 200);
    assert.equal(calls.at(-1)[0], `https://${target}.example/functions/v1/record-price${target === "db2" ? "-db2-pilot" : ""}`);
  }
  const blocked = response();
  await history({ method: "GET", query: { shopId: "123", productId: "456" } }, blocked);
  assert.equal(blocked.code, 404);
});
