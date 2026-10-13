import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/admin-health.js';
import { readFileSync, readdirSync } from 'node:fs';
const headers={authorization:'Bearer routing-test-admin'};
process.env.ADMIN_HEALTH_TOKEN='routing-test-admin';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY='sb_secret_test';
async function invoke(req){const r={headers:{},statusCode:0,setHeader(k,v){this.headers[k]=v;return this;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};await handler(req,r);return r;}
test('existing health requests retain method validation and admin protection',async()=>{
 assert.equal((await invoke({method:'POST',headers,query:{}})).statusCode,405);
 assert.equal((await invoke({method:'GET',headers:{},query:{}})).statusCode,401);
});
test('existing health snapshot request and response stay unchanged',async()=>{const old=global.fetch;try{
 const snapshot={total:12,events:[],source:'health'};global.fetch=async(url,opts)=>{assert.equal(url,'https://example.supabase.co/rest/v1/rpc/admin_health_snapshot');assert.equal(opts.method,'POST');assert.deepEqual(JSON.parse(opts.body),{p_limit:200});return Response.json(snapshot);};
 const r=await invoke({method:'GET',headers,query:{}});assert.equal(r.statusCode,200);assert.deepEqual(r.body,snapshot);assert.equal(r.headers['Cache-Control'],'private, max-age=15');
 }finally{global.fetch=old;}});
test('existing health pagination retains its query and response',async()=>{const old=global.fetch;try{global.fetch=async(url)=>{const query=new URL(url).searchParams;assert.equal(query.get('offset'),'200');assert.equal(query.get('limit'),'200');return Response.json([{id:1}]);};const r=await invoke({method:'GET',headers,query:{offset:'200'}});assert.equal(r.statusCode,200);assert.deepEqual(r.body,{events:[{id:1}],hasMore:false});}finally{global.fetch=old;}});
test('existing backup and push dispatch remain protected',async()=>{
 const backup=await invoke({method:'POST',headers:{},query:{backup:'1'},body:{action:'catalog'}});assert.equal(backup.statusCode,401);
 const push=await invoke({method:'GET',headers:{},query:{push:'1'}});assert.equal(push.statusCode,401);
});
test('public articles route uses published snapshots without granting admin access',async()=>{const old=global.fetch;try{global.fetch=async(url)=>{assert.match(url,/\/published_articles\?/);assert.equal(new URL(url).searchParams.get('slug'),'eq.example');return Response.json([{title:'Example',slug:'example'}]);};const r=await invoke({method:'GET',headers:{},query:{articleRoute:'public',slug:'example'}});assert.equal(r.statusCode,200);assert.equal(r.body.articles[0].slug,'example');assert.equal(r.headers['Cache-Control'],'no-store');}finally{global.fetch=old;}
 assert.equal((await invoke({method:'POST',headers:{},query:{articleRoute:'admin'},body:{action:'publish'}})).statusCode,401);
});
test('admin article route preserves save input and revision checks',async()=>{const old=global.fetch;try{global.fetch=async(url,opts)=>{assert.match(url,/\/articles$/);const row=JSON.parse(opts.body);assert.equal(row.title,'Draft title');assert.equal(row.revision,1);return Response.json([{...row,id:'12345678-1234-1234-1234-123456789abc'}]);};const r=await invoke({method:'POST',headers,query:{articleRoute:'admin'},body:{action:'save',article:{title:'Draft title',slug:'draft-title',content:'<p>Draft</p>'}}});assert.equal(r.statusCode,200);assert.equal(r.body.article.revision,1);}finally{global.fetch=old;}});
test('article URL rewrites preserve public URLs and deployment stays at 12 functions',()=>{
 const cfg=JSON.parse(readFileSync('vercel.json','utf8'));for(const [source,route] of [['/api/articles','public'],['/api/admin-articles','admin']])assert.ok(cfg.rewrites.some(r=>r.source===source && r.destination===`/api/admin-health?articleRoute=${route}`));
 assert.equal(readdirSync('api').filter(p=>p.endsWith('.js')).length,12);
});
