import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../extension/community-collector-bridge.js',import.meta.url),'utf8');
function run(query,text){const messages=[];let tick;const context={URL,location:{href:`https://shopee.ph/product/12/34${query}`,pathname:'/product/12/34'},document:{body:{innerText:text}},setInterval(fn){tick=fn;return 1},clearInterval(){},window:{name:'ptph-community-test',opener:{postMessage(data,origin){messages.push({data,origin})}},addEventListener(){}}};vm.runInNewContext(source,context);return {context,messages,tick};}
test('bridge leaves ordinary and admin Shopee pages unchanged',()=>{const result=run('',"The product doesn't exist");assert.equal(result.messages.length,0);assert.equal(result.context.PriceTrackProductPageOutcome,undefined);});
test('community bridge reports readiness and delayed unavailable outcomes with identity',()=>{const result=run('?ptph_community=1','Loading');assert.equal(result.messages[0].data.type,'collector-ready');result.context.document.body.innerText="The product doesn’t exist";result.tick();const message=result.messages.at(-1);assert.equal(message.data.outcome,'does_not_exist');assert.equal(message.data.shopId,'12');assert.equal(message.data.externalProductId,'34');assert.equal(message.origin,'https://pricetrackph.com');});
test('verification is reported separately from unavailable products',()=>{const result=run('?ptph_community=1','Security verification');assert.equal(result.messages.at(-1).data.outcome,'verification');});
