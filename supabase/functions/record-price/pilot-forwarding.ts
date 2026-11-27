import { completeCollectionQueues } from "./queue-completion.ts";
import { enqueueFirefoxRecording, shouldQueueFirefoxRecording } from "./firefox-priority.ts";

const identities = new Set(["1408391598:29280298218", "276556301:19841104743", "70046721:45369645174"]);
type Body = { shopId?: string; productId?: string; canonicalUrl?: string; pageOutcome?: string; isAdminCollector?: boolean; activity?: Record<string, unknown> };
type Context = { url: string; secret: string; token: string; source: string; extension: string; clientHash: string | null };
function headers(secret: string) {
  return { apikey: secret, ...(secret.startsWith("ey") ? { Authorization: `Bearer ${secret}` } : {}), "content-type": "application/json" };
}

export async function forwardPilotRecording(request: Request, body: Body, context: Context, fetcher: typeof fetch = fetch) {
  if (body.pageOutcome != null || !identities.has(`${body.shopId}:${body.productId}`)) return null;
  const controlHeaders = headers(context.secret);
  const config = await fetcher(`${context.url}/rest/v1/site_settings?key=eq.db2_pilot_live&select=boolean_value&limit=1`, { headers: controlHeaders });
  if (!config.ok) throw Error("Unable to read pilot routing setting");
  if ((await config.json())[0]?.boolean_value !== true) return null;
  // Fixed destination: callers cannot supply a forwarding URL or bypass a
  // disabled/misconfigured route by making the request fall back to DB1.
  const forwarded = await fetcher("https://pricetrackph.com/api/observations", {
    method: "POST", signal: AbortSignal.timeout(45000),
    headers: { "content-type": "application/json", "user-agent": request.headers.get("user-agent") || "",
      "x-pricetrack-pilot-token": context.token,
      ...(request.headers.get("x-pricetrack-client-id") ? { "x-pricetrack-client-id": request.headers.get("x-pricetrack-client-id")! } : {}),
      ...(request.headers.get("x-pricetrack-internal-token") ? { "x-pricetrack-internal-token": request.headers.get("x-pricetrack-internal-token")! } : {}) },
    body: JSON.stringify(body),
  });
  const result = await forwarded.json();
  if (!forwarded.ok) return { status: forwarded.status, body: result };
  const check = result.pilotCheck;
  if (!check || !["success", "partial", "failure"].includes(check.status) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(check.date) || !Number.isFinite(Date.parse(check.at))) {
    throw Error("DB2 recording returned no check receipt");
  }
  const query = new URLSearchParams({ platform: "eq.shopee", external_shop_id: `eq.${body.shopId}`, external_product_id: `eq.${body.productId}`, select: "id", limit: "1" });
  const identity = await fetcher(`${context.url}/rest/v1/products?${query}`, { headers: controlHeaders });
  if (!identity.ok) throw Error("Unable to find pilot scheduling record");
  const [product] = await identity.json();
  if (!product?.id) throw Error("Pilot scheduling record is missing");
  const details: Record<string,unknown> = {};
  for (const key of ["name","product_url","shop_name","image_url","metadata","last_seen_at","updated_at"]) {
    if (check.product && Object.hasOwn(check.product,key)) details[key] = check.product[key];
  }
  if (check.priceDropAt) details.price_drop_at = check.priceDropAt;
  if (Object.keys(details).length) {
    const updated = await fetcher(`${context.url}/rest/v1/products?id=eq.${product.id}`, {
      method:"PATCH",headers:{...controlHeaders,Prefer:"return=minimal"},body:JSON.stringify(details),
    });
    if (!updated.ok) throw Error("Unable to update pilot scheduling metadata");
  }
  const activity = body.activity || {};
  const value = (key: string) => activity[key] != null && Number.isFinite(Number(activity[key])) ? Number(activity[key]) : null;
  const activityResponse = await fetcher(`${context.url}/rest/v1/rpc/record_product_activity`, {
    method:"POST",headers:controlHeaders,
    body:JSON.stringify({p_product_id:product.id,p_observed_date:check.date,p_observed_at:check.at,
      p_client_hash:context.clientHash,p_is_admin_collector:context.source === "scheduled_collector" || body.isAdminCollector === true,
      p_total_sold:value("totalSold"),p_view_count:value("viewCount"),p_review_count:value("reviewCount"),
      p_favorite_count:value("favoriteCount"),p_rating:value("rating"),p_discount_percent:value("discountPercent")}),
  });
  if (!activityResponse.ok) throw Error("Unable to update pilot activity");
  const marked = await fetcher(`${context.url}/rest/v1/rpc/mark_product_check`, {
    method: "POST", headers: controlHeaders,
    body: JSON.stringify({ p_product_id: product.id, p_checked_date: check.date, p_checked_at: check.at,
      p_source: context.source, p_status: check.status, p_variation_count: result.variationCount,
      p_changed_count: result.recordedCount, p_unchanged_count: result.unchangedCount,
      p_failed_count: result.failedCount, p_metadata: check.metadata }),
  });
  if (!marked.ok) throw Error("Unable to confirm pilot collection status");
  const diagnostic = await fetcher(`${context.url}/rest/v1/diagnostic_events`, {
    method:"POST",headers:{...controlHeaders,Prefer:"return=minimal"},
    body:JSON.stringify({event_type:result.failedCount > 0 ? "record_partial" : "record_success",source:"record-price",
      shop_id:body.shopId,product_id:body.productId,variation_count:result.variationCount,recorded_count:result.recordedCount,
      unchanged_count:result.unchangedCount,failed_count:result.failedCount,status_code:forwarded.status,details:{database:"db2"}}),
  });
  if (!diagnostic.ok) console.error("Unable to save pilot recording diagnostic");
  if (check.status === "success") {
    if (shouldQueueFirefoxRecording(request.headers.get("user-agent") || "", context.source, body.isAdminCollector === true, context.extension)) {
      const queued = await enqueueFirefoxRecording(fetcher, context.url, controlHeaders, {
        shopId: body.shopId!, productId: body.productId!, canonicalUrl: body.canonicalUrl!,
      });
      if (!queued.ok) throw Error("Unable to finish pilot browser queue handoff");
    } else {
      const failures = await completeCollectionQueues(fetcher, context.url, controlHeaders, {
        platform: "shopee", shopId: body.shopId!, productId: body.productId!,
      });
      if (failures.length) throw Error("Unable to finish pilot collection queues");
    }
  }
  // Receipts are for the server handoff, not a change to the extension protocol.
  const { pilotCheck: _receipt, ...publicResult } = result;
  return { status: forwarded.status, body: publicResult };
}
