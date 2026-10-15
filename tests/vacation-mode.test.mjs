import test from 'node:test';
import assert from 'node:assert/strict';
import requestHandler from '../api/public-collection-request.js';
import settingsHandler from '../api/site-settings.js';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY='test-secret';
process.env.ADMIN_HEALTH_TOKEN='admin-test';
const body={shopId:'123',productId:'456',productUrl:'https://shopee.ph/product/123/456',deviceId:'11111111-1111-4111-8111-111111111111'};
function res(){return {code:0,status(c){this.code=c;return this},setHeader(){return this},json(b){this.body=b;return this}}}
test('vacation changes only accepted request messages; queues receive identical input',async()=>{
 for(const recheckTracked of [false,true])for(const status of ['queued','duplicate','checked_today','limit_reached']){
  const outputs=[];const queueInputs=[];
  for(const enabled of [false,true]){
   global.fetch=async(url,opts)=>{
    if(url.includes('/site_settings?'))return Response.json([{boolean_value:enabled}]);
    assert.ok(url.endsWith('/rpc/enqueue_public_collection_request'));queueInputs.push(JSON.parse(opts.body));return Response.json({status});
   };
   const r=res();await requestHandler({method:'POST',headers:{'user-agent':'Android Mobile'},body:{...body,recheckTracked}},r);outputs.push(r);
  }
  assert.deepEqual(queueInputs[0],queueInputs[1]);assert.equal(outputs[0].code,outputs[1].code);assert.equal(outputs[0].body.status,outputs[1].body.status);
  if(['queued','duplicate'].includes(status))assert.equal(outputs[1].body.message,outputs[0].body.message+' We’re currently on vacation, so price updates may take longer than usual.');
  else assert.deepEqual(outputs[0].body,outputs[1].body);
 }
});
test('notice lookup failure does not turn a successful request into an error',async()=>{
 global.fetch=async url=>{if(url.includes('site_settings'))throw Error('unavailable');return Response.json({status:'queued'})};
 const r=res();await requestHandler({method:'POST',headers:{'user-agent':'Android'},body},r);assert.equal(r.code,200);assert.ok(!r.body.message.includes('vacation'));
});
test('vacation setting defaults off and requires admin authorization to change',async()=>{
 global.fetch=async()=>Response.json([]);let r=res();await settingsHandler({method:'GET',headers:{}},r);assert.equal(r.body.vacationMode,false);
 r=res();await settingsHandler({method:'PATCH',headers:{},body:{vacationMode:true}},r);assert.equal(r.code,401);
 for(const enabled of [true,false]){
  let saved;
  global.fetch=async(url,opts)=>{if(opts.method==='POST'){saved=JSON.parse(opts.body);return Response.json([])}return Response.json(url.includes('site_settings')?[{key:'vacation_mode',boolean_value:enabled}]:[])};
  r=res();await settingsHandler({method:'PATCH',headers:{authorization:'Bearer admin-test'},body:{vacationMode:enabled}},r);assert.equal(r.code,200);assert.equal(saved.key,'vacation_mode');assert.equal(saved.boolean_value,enabled);assert.equal(r.body.vacationMode,enabled);
 }
});
