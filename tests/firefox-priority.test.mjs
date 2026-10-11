import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldQueueFirefoxRecording, enqueueFirefoxRecording } from '../supabase/functions/record-price/firefox-priority.ts';
test('only public Firefox recordings get the handoff', () => {
 assert.equal(shouldQueueFirefoxRecording('Mozilla/5.0 Firefox/143.0','extension',false),true);
 assert.equal(shouldQueueFirefoxRecording('Mozilla/5.0 Chrome/143.0','extension',false),false);
 assert.equal(shouldQueueFirefoxRecording('Mozilla/5.0 Firefox/143.0','extension',true),false);
 assert.equal(shouldQueueFirefoxRecording('Mozilla/5.0 Firefox/143.0','scheduled_collector',false),false);
});
test('handoff uses the one-time RPC and stable product identity', async () => {
 let call;
 await enqueueFirefoxRecording(async (url,options) => {call={url,options};return {ok:true};},'https://example.test',{}, {shopId:'123',productId:'456',canonicalUrl:'https://shopee.ph/product/123/456'});
 assert.equal(call.url,'https://example.test/rest/v1/rpc/enqueue_firefox_collection_request');
 assert.deepEqual(JSON.parse(call.options.body),{p_external_shop_id:'123',p_external_product_id:'456',p_product_url:'https://shopee.ph/product/123/456'});
});
