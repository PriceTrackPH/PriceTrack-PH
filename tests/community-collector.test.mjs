import test from 'node:test';
import assert from 'node:assert/strict';
import handler,{encodeClaim,decodeClaim} from '../server/community-collector.js';
const secret='test-secret';
test('claims reject tampering and expiry',()=>{const claim={id:8,lease:'x',expires:Date.now()+10000};assert.deepEqual(decodeClaim(encodeClaim(claim,secret),secret),claim);assert.throws(()=>decodeClaim(encodeClaim(claim,secret)+'x',secret));assert.throws(()=>decodeClaim(encodeClaim({...claim,expires:0},secret),secret));});
function response(){return {statusCode:0,setHeader(){return this},status(n){this.statusCode=n;return this},json(body){this.body=body;return this}};}
test('watchlist is claimed before Normal Queue and release checks exact lease',async()=>{
 const old=global.fetch;process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SECRET_KEY=secret;let calls=[];
 global.fetch=async(url,options={})=>{calls.push([url,options]);let data=url.includes('select=id,')?[{id:8,external_shop_id:'12',external_product_id:'34'}]:options.method==='PATCH'?[{id:8}]:[{name:'Test',image_url:null,last_checked_at:'2026-10-01T00:00:00Z'}];return {ok:true,status:200,json:async()=>data};};
 try{const res=response();await handler({headers:{origin:'https://pricetrackph.com',host:'pricetrackph.com'},body:{action:'claim',watchlist:[8],excluded:[]}},res);assert.equal(res.statusCode,200);assert.equal(res.body.product.source,'Watchlist');assert.ok(calls[0][0].includes('last_checked_at.lt.'));assert.ok(!calls[0][0].includes('next_check_at'));assert.ok(!calls[0][0].includes('is_active=eq.true'));assert.ok(!calls[0][0].includes('all_variations_sold_out'));assert.ok(calls[1][0].includes('last_checked_at.lt.'));assert.ok(!calls.some(([url])=>url.includes('/rpc/')));const token=res.body.product.token;calls=[];await handler({headers:{origin:'https://pricetrackph.com'},body:{action:'release',token}},response());assert.ok(calls[0][0].includes('check_lease_until=eq.'));}finally{global.fetch=old;}
});
test('untrusted origins cannot claim products',async()=>{const res=response();await handler({headers:{origin:'https://other.test',host:'pricetrackph.com'},body:{action:'claim'}},res);assert.equal(res.statusCode,403);});
test('normal queue is used after eligible watchlist is exhausted',async()=>{const old=global.fetch;global.fetch=async(url)=>({ok:true,status:200,json:async()=>url.includes('/rpc/')?[{product_id:7,shop_id:'12',external_product_id:'34',product_url:'https://shopee.ph/product/12/34',lease_until:'2026-10-21T00:00:00Z'}]:[{name:'Normal',last_checked_at:null}]});try{const res=response();await handler({headers:{origin:'https://pricetrackph.com'},body:{action:'claim',watchlist:[]}},res);assert.equal(res.body.product.source,'Normal Queue');assert.equal(res.body.product.id,7);}finally{global.fetch=old;}});
test('outcome uses signed identity and only a matching reservation can save it',async()=>{
 const old=global.fetch;let calls=[];let owned=true;
 process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SECRET_KEY=secret;
 const token=encodeClaim({id:8,shopId:'12',externalProductId:'34',lease:new Date(Date.now()+60000).toISOString(),expires:Date.now()+120000},secret);
 global.fetch=async(url,options={})=>{calls.push([url,options]);return {ok:true,status:200,json:async()=>url.includes('/rpc/')?{outcome:'does_not_exist'}:owned?[{id:8}]:[]};};
 try{
  const req={headers:{origin:'https://pricetrackph.com'},body:{action:'outcome',token,outcome:'does_not_exist',shopId:'999',externalProductId:'999'}};
  const res=response();await handler(req,res);assert.equal(res.statusCode,200);
  const rpc=calls.find(([url])=>url.includes('/rpc/mark_collector_product_outcome'));assert.ok(rpc);
  const payload=JSON.parse(rpc[1].body);assert.equal(payload.p_product_id,8);assert.equal(payload.p_external_shop_id,'12');assert.equal(payload.p_external_product_id,'34');assert.equal(payload.p_claim_source,'random');
  owned=false;calls=[];const replay=response();await handler(req,replay);assert.equal(replay.body.alreadyFinished,true);assert.ok(!calls.some(([url])=>url.includes('/rpc/')));
  calls=[];const invalid=response();await handler({...req,body:{...req.body,outcome:'verification'}},invalid);assert.equal(invalid.statusCode,400);assert.equal(calls.length,0);
 }finally{global.fetch=old;}
});
test('remaining counts unchecked watchlist products without changing saved products',async()=>{
 const old=global.fetch;process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SECRET_KEY=secret;const methods=[];
 global.fetch=async(url,options)=>{methods.push(options.method);return {ok:true,status:200,json:async()=>[{id:1,last_checked_at:new Date().toISOString()},{id:2,last_checked_at:null},{id:3,last_checked_at:'2020-01-01T00:00:00Z'},{id:4,collector_page_outcome:'unlisted',last_check_attempt_at:new Date().toISOString()}]};};
 try{const res=response();await handler({headers:{origin:'https://pricetrackph.com'},body:{action:'remaining',watchlist:[1,2,3,4]}},res);assert.equal(res.body.remaining,2);assert.deepEqual(methods,[undefined]);}finally{global.fetch=old;}
});
