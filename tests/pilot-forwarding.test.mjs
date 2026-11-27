import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {forwardPilotRecording} from '../supabase/functions/record-price/pilot-forwarding.ts';
import observations from '../api/observations.js';

const body={shopId:'1408391598',productId:'29280298218',canonicalUrl:'https://shopee.ph/product/1408391598/29280298218'};
const context={url:'https://db1.example',secret:'primary-key',token:'signed',source:'extension',extension:'web',clientHash:'client'};
const receipt={ok:true,variationCount:9,recordedCount:9,unchangedCount:0,failedCount:0,lowestPrice:97,
  pilotCheck:{status:'success',date:'2026-11-27',at:'2026-11-27T07:52:00Z',metadata:{all_variations_unchanged:false},product:{name:'KATINKO'}}};
function harness({enabled=true,saveStatus=201,failMark=false,firefox=false}={}) {
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    if(url.includes('/site_settings?'))return Response.json([{boolean_value:enabled}]);
    if(url.includes('/api/observations'))return Response.json(receipt,{status:saveStatus});
    if(url.includes('/products?') && !options?.method)return Response.json([{id:133712}]);
    if(failMark && url.endsWith('/mark_product_check'))return new Response('',{status:503});
    return Response.json(null);
  };
  const request=new Request('https://db1.example/functions/v1/record-price',{headers:{'user-agent':firefox?'Firefox/143.0':'Chrome/140'}});
  return {calls,fetcher,request};
}
test('only the three pilot identities can forward and a disabled pilot preserves DB1',async()=>{
  const h=harness({enabled:false});
  assert.equal(await forwardPilotRecording(h.request,{...body,productId:'999'},context,h.fetcher),null);
  assert.equal(h.calls.length,0);
  assert.equal(await forwardPilotRecording(h.request,body,context,h.fetcher),null);
  assert.equal(h.calls.length,1);
  assert.equal(await forwardPilotRecording(h.request,{...body,pageOutcome:'sold_out'},context,h.fetcher),null);
});
test('a successful DB2 save updates central check/activity/queues, without DB1 price writes',async()=>{
  const h=harness();
  const result=await forwardPilotRecording(h.request,body,context,h.fetcher);
  assert.equal(result.status,201);
  assert.equal(result.body.lowestPrice,97);
  assert.equal('pilotCheck' in result.body,false);
  assert.equal(h.calls.filter(c=>c.url.includes('/api/observations')).length,1);
  assert.ok(h.calls.some(c=>c.url.endsWith('/mark_product_check')));
  assert.ok(h.calls.some(c=>c.url.endsWith('/record_product_activity')));
  assert.ok(h.calls.some(c=>c.url.endsWith('/complete_public_collection_request')));
  assert.ok(h.calls.some(c=>c.url.endsWith('/complete_store_collection_request')));
  assert.ok(!h.calls.some(c=>c.url.includes('/price_observations')||c.url.includes('/product_variations')));
});
test('Firefox retains its existing priority handoff',async()=>{
  const h=harness({firefox:true});
  await forwardPilotRecording(h.request,body,{...context,extension:'firefox'},h.fetcher);
  assert.ok(h.calls.some(c=>c.url.endsWith('/enqueue_firefox_collection_request')));
  assert.ok(!h.calls.some(c=>c.url.endsWith('/complete_public_collection_request')));
});
test('DB2 failures do not complete queues or write to DB1; failed status sync is reported',async()=>{
  const h=harness({saveStatus:503});
  assert.equal((await forwardPilotRecording(h.request,body,context,h.fetcher)).status,503);
  assert.equal(h.calls.length,2);
  const bad=harness({failMark:true});
  await assert.rejects(forwardPilotRecording(bad.request,body,context,bad.fetcher),/confirm pilot/);
  assert.ok(!bad.calls.some(c=>c.url.endsWith('/complete_public_collection_request')));
});
test('production forwarding authenticates DB1 and translates the scheduled token for DB2',async t=>{
  const values={VERCEL_ENV:'production',PRICETRACK_DB2_PILOT:'1',PRICETRACK_DB2_PILOT_LIVE:'1',PRICETRACK_DB2_PRODUCTS:'1408391598:29280298218',SUPABASE_SECRET_KEY:'primary-key',SUPABASE_DB2_URL:'https://db2.example',SUPABASE_DB2_PUBLISHABLE_KEY:'eyJ-public',SUPABASE_DB2_SECRET_KEY:'secondary-key'};
  const saved={...process.env};Object.assign(process.env,values);
  t.after(()=>{for(const k of Object.keys(values))saved[k]===undefined?delete process.env[k]:process.env[k]=saved[k];});
  const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return Response.json(receipt,{status:201});});
  const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}};
  await observations({method:'POST',headers:{'x-pricetrack-pilot-token':hash('primary-key'),'x-pricetrack-internal-token':hash('primary-key')},body:{...body,source:'scheduled_collector'}},res);
  assert.equal(res.code,201);
  assert.equal(calls[0].url,'https://db2.example/functions/v1/record-price-db2-pilot');
  assert.equal(calls[0].options.headers['x-pricetrack-internal-token'],hash('secondary-key'));
  calls.length=0;
  await observations({method:'POST',headers:{'x-pricetrack-pilot-token':'wrong'},body},res);
  assert.equal(res.code,503);assert.equal(calls.length,0);
});
