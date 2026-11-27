import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {recordOwnedProduct} from '../server/owned-recording.js';
import {forwardOwnedRecording} from '../supabase/functions/record-price/owned-forwarding.ts';
import {collectorFetch} from '../server/collector-fetch.js';
const env={PRICETRACK_DATABASE_ROUTING:'1',SUPABASE_URL:'https://db1.example',SUPABASE_SECRET_KEY:'primary-private',SUPABASE_DB2_URL:'https://db2.example',SUPABASE_DB2_SECRET_KEY:'secondary-private',SUPABASE_DB2_PUBLISHABLE_KEY:'eyJ-secondary-public'};
const body={platform:'shopee',shopId:'123',productId:'456',canonicalUrl:'https://shopee.ph/product/123/456',title:'Product',source:'extension',extensionId:'web'};
const receipt=()=>({kind:'price',product:{id:7,external_shop_id:'123',external_product_id:'456'},hasActiveVariations:true,check:{status:'success',metadata:{all_variations_unchanged:true}},existedBeforeRecording:true});
function fake({error=false,mirrorError=false,existing=true,invalid=false}={}) {
 const calls=[];
 const fetcher=async(url,options={})=>{
  calls.push([url,options]);
  if(url.includes('/product_database_directory?'))return Response.json([{database_id:'db2',internal_product_id:7,migration_in_progress:false}]);
  if(url.includes('/functions/'))return error?Response.json({error:'Unavailable'},{status:503}):Response.json({ok:true,recordedCount:0,unchangedCount:1,failedCount:0,ownedReceipt:{...receipt(),existedBeforeRecording:existing,...(invalid?{product:{id:8}}:{})}});
  if(url.includes('/rpc/sync_owned_product_queue')&&mirrorError)return new Response('',{status:503});
  return Response.json(null);
 };
 return {calls,fetcher};
}
test('owned recorder failure or invalid identity never completes a queue or writes a DB1 price',async()=>{
 for(const options of [{error:true},{mirrorError:true},{invalid:true}]){
  const f=fake(options);
  if(options.error)assert.equal((await recordOwnedProduct(env,body,{},f.fetcher)).status,503);
  else await assert.rejects(recordOwnedProduct(env,body,{},f.fetcher));
  assert.ok(!f.calls.some(([url])=>/complete_.*collection_request/.test(url)));
  assert.ok(!f.calls.some(([url])=>url.startsWith(env.SUPABASE_URL)&&/\/(products|product_variations|price_observations)\?/.test(url)));
 }
});
test('Firefox only queues new identities; existing identities retain their original priority behavior',async()=>{
 for(const existing of [true,false]){
  const f=fake({existing});
  const result=await recordOwnedProduct(env,{...body,extensionId:'firefox'},{},f.fetcher);
  assert.equal(result.body.ownedReceipt,undefined);
  assert.equal(f.calls.filter(([url])=>url.includes('enqueue_firefox')).length,existing?0:1);
  assert.ok(!f.calls.some(([url])=>url.includes('complete_public')));
 }
});
test('scheduled captures require verified internal authorization and use the owning secret',async()=>{
 const f=fake();
 await assert.rejects(recordOwnedProduct(env,{...body,source:'scheduled_collector'},{},f.fetcher),/authorization/);
 f.calls.length=0;
 await recordOwnedProduct(env,{...body,source:'scheduled_collector'},{},f.fetcher,true);
 const [,options]=f.calls.find(([url])=>url.includes('/functions/'));
 assert.equal(options.headers['x-pricetrack-internal-token'],crypto.createHash('sha256').update('secondary-private').digest('hex'));
 assert.equal(options.headers['x-pricetrack-product-id'],'7');
});
test('legacy direct extension forwarding is off until activated and never falls back after ownership changes',async()=>{
 const req=new Request('https://primary.example/functions/v1/record-price',{method:'POST',body:JSON.stringify(body)});
 const context={url:'https://db1.example',secret:'private',token:'signed'};
 assert.equal(await forwardOwnedRecording(req,body,context,async()=>Response.json([{boolean_value:false}])),null);
 const calls=[];
 const result=await forwardOwnedRecording(req,body,context,async(url,options)=>{
  calls.push([url,options]);
  return Response.json(url.includes('/site_settings?')?[{boolean_value:true}]:url.includes('/rpc/')?'db2':{error:'Destination unavailable'},{status:url.includes('/api/observations')?503:200});
 });
 assert.equal(result.status,503);
 assert.equal(calls.at(-1)[0],'https://pricetrackph.com/api/observations');
 assert.equal(calls.at(-1)[1].headers['x-pricetrack-owner-token'],'signed');
});
test('collector leases are central; product/history reads are not rewritten',async()=>{
 const urls=[];const fetcher=async(url)=>{urls.push(url);return Response.json([]);};
 await collectorFetch('https://db1.example/rest/v1/products?id=eq.7',{method:'PATCH'},env,fetcher);
 await collectorFetch('https://db2.example/rest/v1/products?id=eq.7',{},env,fetcher);
 await collectorFetch('https://db1.example/rest/v1/price_observations?variation_id=eq.7',{},env,fetcher);
 assert.equal(urls[0],'https://db1.example/rest/v1/collector_products?id=eq.7');
 assert.equal(urls[1],'https://db2.example/rest/v1/products?id=eq.7');
 assert.equal(urls[2],'https://db1.example/rest/v1/price_observations?variation_id=eq.7');
});
