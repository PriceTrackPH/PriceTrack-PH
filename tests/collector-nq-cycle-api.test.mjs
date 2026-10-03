import test from "node:test";
import assert from "node:assert/strict";
import handler, { claimNextProduct, claimRandomProduct } from "../api/admin-pc-collector.js";
const product = { product_id:42,shop_id:"100",external_product_id:"200",product_url:"https://shopee.ph/product/100/200",lease_until:"2026-10-03T14:00:00Z" };
test("milestone selects special claim and empty pools fall back without blocking NQ", async () => {
  const before=global.fetch;
  try {
    global.fetch=async(url,options)=>{assert.match(String(url),/claim_nq_cycle_product$/);assert.equal(JSON.parse(options.body).p_mode,"low");return {ok:true,json:async()=>[product]};};
    assert.equal((await claimRandomProduct("https://example.supabase.co","secret",[],true,null,"low")).nqCycleMode,"low");
    global.fetch=async(url)=>({ok:true,json:async()=>String(url).includes("claim_nq_cycle_product")?[]:[product]});
    const fallback=await claimRandomProduct("https://example.supabase.co","secret",[],true,null,"unavailable");
    assert.equal(fallback.nqCycleFallback,true);
    assert.equal(fallback.nqCycleMode,"unavailable");
  } finally {global.fetch=before;}
});
test("priority still runs before the NQ milestone", async () => {
  const before=global.fetch;
  try {
    global.fetch=async(url)=>{assert.match(String(url),/claim_oldest_public_collection_request$/);return {ok:true,json:async()=>[{request_id:"q",shop_id:"100",external_product_id:"200",product_url:product.product_url,lease_until:product.lease_until}]};};
    const selected=await claimNextProduct("https://example.supabase.co","secret",[],[],product.lease_until,[],false,true,"normal",true,false,true,null,null,true,"unavailable");
    assert.equal(selected.claimSource,"priority");
  } finally {global.fetch=before;}
});
test("extra unavailable check returning in stock clears the old skip date", async () => {
  const before=global.fetch;
  const keys=["ADMIN_HEALTH_TOKEN","SUPABASE_URL","SUPABASE_SECRET_KEY","VITE_SUPABASE_PUBLISHABLE_KEY"];
  const env=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{ADMIN_HEALTH_TOKEN:"admin-token",SUPABASE_URL:"https://example.supabase.co",SUPABASE_SECRET_KEY:"secret",VITE_SUPABASE_PUBLISHABLE_KEY:"publishable"});
  let reset;
  global.fetch=async(url,options={})=>{
    const text=String(url);
    if(options.method==="PATCH"){reset=JSON.parse(options.body);return {ok:true};}
    if(text.includes("product_daily_checks"))return {ok:true,json:async()=>[{id:1,checked_at:"2026-10-03T12:00:00Z",metadata:{}}]};
    if(text.includes("select=all_variations_sold_out"))return {ok:true,json:async()=>[{all_variations_sold_out:false,next_check_at:"2026-11-02T12:00:00Z"}]};
    if(text.includes("select=external_shop_id"))return {ok:true,json:async()=>[{external_shop_id:"100",external_product_id:"200"}]};
    if(text.includes("collector_backlog_complete_active"))return {ok:true,json:async()=>0};
    throw Error(text);
  };
  try {
    let result;
    await handler({method:"POST",headers:{authorization:"Bearer admin-token"},query:{action:"status"},body:{productId:42,claimSource:"random",nqCycleMode:"unavailable"}},
    {status(){return this;},setHeader(){return this;},json(value){result=value;return this;}});
    assert.equal(result.completed,true);
    assert.deepEqual(reset,{next_check_at:"2026-10-03T16:00:00.000Z"});
  } finally {
    global.fetch=before;
    for(const [k,v] of Object.entries(env)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
});
