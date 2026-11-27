import { test } from "node:test";
import assert from "node:assert/strict";
import { recordingDestination } from "../server/product-database.js";
import observations from "../api/observations.js";

const env = {
  PRICETRACK_DATABASE_ROUTING: "1", SUPABASE_URL: "https://db1.example",
  SUPABASE_SECRET_KEY: "server-only", VITE_SUPABASE_PUBLISHABLE_KEY: "public-db1",
  SUPABASE_DB2_URL: "https://db2.example", SUPABASE_DB2_PUBLISHABLE_KEY: "public-db2",
  SUPABASE_DB5_URL: "https://db5.example", SUPABASE_DB5_PUBLISHABLE_KEY: "public-db5",
  SUPABASE_DB12_URL: "https://db12.example", SUPABASE_DB12_PUBLISHABLE_KEY: "public-db12",
};
const identity = { shopId: "123", productId: "456" };

test("disabled directory leaves the existing route untouched", async () => {
  assert.equal(await recordingDestination({}, identity, () => { throw Error("Unexpected lookup"); }), null);
});
test("the assigned owner selects exactly one configured database, including DB5", async () => {
  for (const owner of ["db1", "db2", "db5", "db12"]) {
    const calls = [];
    const target = await recordingDestination(env, identity, async (url, options) => {
      calls.push({ url, options });
      return Response.json(owner);
    });
    assert.equal(target.url, `https://${owner}.example`);
    assert.equal(target.publishableKey, `public-${owner}`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://db1.example/rest/v1/rpc/assign_product_database");
    assert.deepEqual(JSON.parse(calls[0].options.body), { p_platform: "shopee", p_shop_id: "123", p_product_id: "456" });
  }
});
test("unknown owners, missing credentials, and directory failures never fall back", async () => {
  for (const response of [Response.json("db6"), Response.json("https://attacker.example"), Response.json("db3"), new Response("", {status:503})]) {
    await assert.rejects(recordingDestination(env, identity, async () => response));
  }
});
test("recording endpoint forwards an assigned product once and preserves its payload", async t => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(env)) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]; });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.includes("/rpc/") ? "db2" : {ok:true,recordedCount:9}, {status:url.includes("/rpc/") ? 200 : 201});
  });
  const body = {...identity, title:"Example", canonicalUrl:"https://shopee.ph/product/123/456",installationId:"52a9a100-9981-4b98-b70e-81673a31a3d2", observedAt:"2026-11-27T07:52:00Z", variations:[{variationId:"7",variationName:"Small",price:97}]};
  const res = {setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}};
  await observations({method:"POST",headers:{},body},res);
  assert.equal(res.code,201);
  assert.equal(calls.length,2);
  assert.equal(calls[1].url,"https://db2.example/functions/v1/record-price");
  assert.deepEqual(JSON.parse(calls[1].options.body),body);
  calls.length=0;
  await observations({method:"POST",headers:{},body:{...body,variations:[{variationId:"7",price:0}]}},res);
  assert.equal(res.code,400);
  assert.equal(calls.length,0);
  t.mock.method(globalThis,"fetch",async url=>{calls.push(url);return new Response("",{status:503});});
  await observations({method:"POST",headers:{},body},res);
  assert.equal(res.code,503);
  assert.equal(calls.length,1);
});
