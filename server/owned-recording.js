import crypto from "node:crypto";
import { databaseConfig, productOwner, serviceHeaders } from "./product-owner.js";

const hash = value => crypto.createHash("sha256").update(value).digest("hex");
export async function recordRoutingFailure(env, body, owner, status=503, fetcher=fetch) {
  try {
    const primary=databaseConfig(env,'db1');
    await fetcher(`${primary.url}/rest/v1/diagnostic_events`,{method:'POST',headers:{...serviceHeaders(primary.secret),'content-type':'application/json',Prefer:'return=minimal'},signal:AbortSignal.timeout(8000),
      body:JSON.stringify({event_type:'record_failure',source:'record-price',shop_id:body.shopId,product_id:body.productId,status_code:status,error_code:'database_route_unconfirmed',details:{database:owner}})});
  }catch{ /* A diagnostics outage must not hide the original recording error. */ }
}
export async function recordOwnedProduct(env, body, incomingHeaders = {}, fetcher = fetch, internalAuthorized = false) {
  const owner = await productOwner(env, { shopId: body.shopId, productId: body.productId }, fetcher);
  if (!owner || owner.missing || owner.owner === "db1" || !Number.isSafeInteger(Number(owner.id)) || Number(owner.id) < 1) throw Error("Invalid owned recording destination");
  if (!owner.publishableKey?.startsWith("eyJ")) throw Error("Assigned recorder requires its legacy anon JWT");
  if (body.source === "scheduled_collector" && !internalAuthorized) throw Error("Invalid internal collector authorization");
  const response = await fetcher(`${owner.url}/functions/v1/record-price-owned`, {
    method: "POST", signal: AbortSignal.timeout(45000),
    headers: { apikey: owner.publishableKey, authorization: `Bearer ${owner.publishableKey}`, "content-type": "application/json",
      "x-pricetrack-routing-token": hash(owner.secret), "x-pricetrack-product-id": String(owner.id),
      "user-agent": String(incomingHeaders["user-agent"] || ""),
      ...(incomingHeaders["x-pricetrack-client-id"] ? { "x-pricetrack-client-id": String(incomingHeaders["x-pricetrack-client-id"]) } : {}),
      ...(internalAuthorized ? { "x-pricetrack-internal-token": hash(owner.secret) } : {}) },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    await recordRoutingFailure(env,body,owner.owner,response.status,fetcher);
    return { status: response.status, body: result };
  }
  const receipt = result.ownedReceipt;
  if (!receipt || !["price", "outcome"].includes(receipt.kind) || Number(receipt.product?.id) !== Number(owner.id) ||
      receipt.product?.external_shop_id !== body.shopId || receipt.product?.external_product_id !== body.productId ||
      typeof receipt.hasActiveVariations !== "boolean" || (receipt.kind === "price" && !["success", "partial", "failure"].includes(receipt.check?.status))) {
    throw Error("Assigned recorder returned an invalid receipt");
  }
  const primary = databaseConfig(env, "db1");
  const headers = { ...serviceHeaders(primary.secret), "content-type": "application/json" };
  async function rpc(name, data) {
    const r = await fetcher(`${primary.url}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(data), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error("Unable to confirm the owned collection in the central queue");
  }
  const check = receipt.check && { ...receipt.check, metadata: Object.fromEntries(
    ["all_variations_sold_out", "all_variations_unchanged", "skip_sold_out", "skip_unchanged_day", "recorded_extension"]
      .filter(key=>Object.hasOwn(receipt.check.metadata || {}, key)).map(key=>[key,receipt.check.metadata[key]])
  ) };
  await rpc("sync_owned_product_queue", { p_database_id: owner.owner, p_product: receipt.product, p_has_active_variations: receipt.hasActiveVariations, p_check: check || null });
  if (receipt.kind === "price" && receipt.check.status === "success") {
    const firefoxLike = body.source !== "scheduled_collector" && body.isAdminCollector !== true &&
      (["edge", "firefox"].includes(body.extensionId) || /(?:Firefox|FxiOS)\//i.test(String(incomingHeaders["user-agent"] || "")));
    if (firefoxLike) {
      if (receipt.existedBeforeRecording !== true) await rpc("enqueue_firefox_collection_request", {
        p_external_shop_id: body.shopId, p_external_product_id: body.productId, p_product_url: body.canonicalUrl,
      });
    } else {
      const identity = { p_platform: "shopee", p_external_shop_id: body.shopId, p_external_product_id: body.productId };
      await rpc("complete_public_collection_request", identity);
      await rpc("complete_store_collection_request", identity);
    }
  }
  const diagnostic = await fetcher(`${primary.url}/rest/v1/diagnostic_events`, {
    method: "POST", headers: { ...headers, Prefer: "return=minimal" }, signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ event_type: receipt.kind === "outcome"&&receipt.product.last_check_status==='failure' ? 'record_failure' : result.failedCount > 0 ? "record_partial" : "record_success",
      source: "record-price", shop_id: body.shopId, product_id: body.productId, variation_count: result.variationCount || 0,
      recorded_count: result.recordedCount || 0, unchanged_count: result.unchangedCount || 0, failed_count: result.failedCount || 0,
      status_code: response.status, ...(body.pageOutcome?{error_code:`collector_${body.pageOutcome}`}:{}) ,details: { database: owner.owner, ...(body.pageOutcome ? {outcome:body.pageOutcome} : {}) } }),
  });
  if (!diagnostic.ok) console.error("Owned recording diagnostic could not be saved");
  const { ownedReceipt: _receipt, ...publicResult } = result;
  return { status: response.status, body: publicResult };
}

export async function recordOwnedOutcome(env, payload, fetcher = fetch) {
  const deadline=AbortSignal.timeout(50000);
  const originalFetch=fetcher;
  fetcher=(url,options={})=>originalFetch(url,{...options,signal:options.signal?AbortSignal.any([deadline,options.signal]):deadline});
  const owner = await productOwner(env, { shopId: payload.shopId, productId: payload.externalProductId }, fetcher);
  if (!owner || owner.missing || owner.owner === "db1") return null;
  const response = await fetcher(`${owner.url}/rest/v1/products?id=eq.${owner.id}&select=name,product_url&limit=1`, { headers: serviceHeaders(owner.secret), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw Error("Unable to find owned collection product");
  const [product] = await response.json();
  if (!product) throw Error("Owned collection product is missing");
  const result = await recordOwnedProduct(env, { platform: "shopee", shopId: payload.shopId, productId: payload.externalProductId,
    canonicalUrl: product.product_url, title: product.name, pageOutcome: payload.outcome,
    source: "scheduled_collector", observedAt: new Date().toISOString() }, {}, fetcher, true);
  if (result.status >= 400) throw Error("Unable to record owned collection outcome");
  return result.body.outcomeResult || { outcome: payload.outcome, retryAfterCurrentRun: payload.outcome === "page_error" };
}
