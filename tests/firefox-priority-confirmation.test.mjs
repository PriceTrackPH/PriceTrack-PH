import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/admin-pc-collector.js';
test('an earlier Firefox daily check cannot confirm a leased one-time Priority job',async()=>{
 const keys=['ADMIN_HEALTH_TOKEN','SUPABASE_URL','SUPABASE_SECRET_KEY','VITE_SUPABASE_PUBLISHABLE_KEY'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const oldFetch=global.fetch;
 Object.assign(process.env,{ADMIN_HEALTH_TOKEN:'test-token',SUPABASE_URL:'https://example.test',SUPABASE_SECRET_KEY:'test-secret',VITE_SUPABASE_PUBLISHABLE_KEY:'test-key'});
 let calls=0;
 global.fetch=async url=>{calls++;assert.match(String(url),/public_collection_requests/);return {ok:true,json:async()=>[{one_time:true,status:'leased'}]};};
 try {
  let result;
  await handler({method:'POST',headers:{authorization:'Bearer test-token'},query:{action:'status'},body:{claimSource:'priority',queueRequestId:'12345678-1234-4123-8123-123456789abc',shopId:'36212881',externalProductId:'21850686382'}},{setHeader(){return this;},status(){return this;},json(value){result=value;}});
  assert.equal(result.completed,false);assert.equal(calls,1);
 }finally{global.fetch=oldFetch;for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
});
