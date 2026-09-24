import crypto from "node:crypto";
import { normalizeDiscoveredProducts, normalizeShopeeStoreUrl } from "../server/store-import-contract.js";

const MAX_BODY_BYTES = 512_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function send(res, status, body) {
  res.status(status).setHeader("Cache-Control", "no-store").json(body);
}

function secretsMatch(actual, expected) {
  if (!actual || !expected) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function adminHeaders(secret, extra = {}) {
  const headers = { apikey: secret, ...extra };
  if (secret.startsWith("ey")) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

function mapStore(row) {
  return {
    id: row.store_id,
    storeKey: row.store_key,
    storeUrl: row.store_url,
    displayName: row.display_name,
    firstAddedAt: row.first_added_at,
    lastScanStartedAt: row.last_scan_started_at,
    lastScanFinishedAt: row.last_scan_finished_at,
    lastScanStatus: row.last_scan_status,
    discovered: Number(row.last_discovered) || 0,
    newlyQueued: Number(row.last_newly_queued) || 0,
    duplicate: Number(row.last_duplicate) || 0,
    alreadyTracked: Number(row.last_already_tracked) || 0,
  };
}

function mapStoreScan(row) {
  const store = row.collection_stores || {};
  return {
    scanId: row.scan_id,
    storeId: row.store_id,
    storeUrl: store.store_url,
    displayName: store.display_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    discovered: safeInteger(row.discovered),
    newlyQueued: safeInteger(row.newly_queued),
    duplicate: safeInteger(row.duplicate),
    alreadyTracked: safeInteger(row.already_tracked),
    soldOut: safeInteger(row.sold_out),
    pagesCurrent: safeInteger(row.pages_current),
    pagesTotal: safeInteger(row.pages_total),
  };
}

async function rpc(supabaseUrl, secret, name, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: adminHeaders(secret, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 1000);
    throw new Error(`${name}_${response.status}${detail ? ` ${detail}` : ""}`);
  }
  return response.json();
}

function safeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function validProduct(product) {
  return product
    && Number.isSafeInteger(Number(product.id))
    && /^\d+$/.test(String(product.external_shop_id || ""))
    && /^\d+$/.test(String(product.external_product_id || ""))
    && typeof product.product_url === "string";
}

async function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function collectorSummary(supabaseUrl, secret) {
  const options = {
    method: "POST",
    headers: adminHeaders(secret, { "Content-Type": "application/json" }),
    body: "{}",
  };
  const [response, priorityResponse, storeResponse] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/rpc/collector_available_summary_v2`, options),
    fetch(`${supabaseUrl}/rest/v1/rpc/public_collection_queue_pending_count`, options),
    fetch(`${supabaseUrl}/rest/v1/rpc/store_collection_queue_pending_count`, options),
  ]);
  if (!response.ok) throw new Error(`collector_summary_${response.status}`);
  if (!priorityResponse.ok) throw new Error(`priority_count_${priorityResponse.status}`);
  if (!storeResponse.ok) throw new Error(`store_count_${storeResponse.status}`);
  const [summary] = await response.json();
  const priorityPending = await priorityResponse.json();
  const storePending = await storeResponse.json();
  return {
    totalTracked: safeInteger(summary?.total_tracked),
    totalDue: safeInteger(summary?.total_due),
    soldOutDeferred: safeInteger(summary?.sold_out_deferred),
    samePriceDeferred: safeInteger(summary?.same_price_deferred),
    priorityPending: safeInteger(Array.isArray(priorityPending) ? priorityPending[0] : priorityPending),
    storeQueuePending: safeInteger(Array.isArray(storePending) ? storePending[0] : storePending),
  };
}

export async function claimPriorityProduct(supabaseUrl, secret, excludedRequestIds = [], leaseUntil) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_oldest_public_collection_request`, {
    method: "POST",
    headers: adminHeaders(secret, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_excluded_request_ids: excludedRequestIds, p_lease_until: leaseUntil }),
  });
  if (!response.ok) throw new Error(`priority_claim_${response.status}`);
  const [request] = await response.json();
  if (!request) return null;
  if (!request.request_id || !/^\d+$/.test(String(request.shop_id || ""))
    || !/^\d+$/.test(String(request.external_product_id || ""))
    || typeof request.product_url !== "string") throw new Error("invalid_priority_product");
  return {
    claimSource: "priority",
    queueRequestId: String(request.request_id),
    productId: null,
    shopId: String(request.shop_id),
    externalProductId: String(request.external_product_id),
    productUrl: request.product_url,
    leaseUntil: request.lease_until,
  };
}

export async function claimRandomProduct(supabaseUrl, secret, excludedProductIds = [], skipSoldOut = true) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_random_available_product_check`, {
    method: "POST",
    headers: adminHeaders(secret, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_excluded_product_ids: excludedProductIds, p_skip_sold_out: skipSoldOut }),
  });
  if (!response.ok) throw new Error(`random_claim_${response.status}`);
  const [product] = await response.json();
  if (!product) return null;
  const normalized = {
    id: product.product_id,
    external_shop_id: product.shop_id,
    external_product_id: product.external_product_id,
    product_url: product.product_url,
  };
  if (!validProduct(normalized)) throw new Error("invalid_due_product");

  return {
    claimSource: "random",
    queueRequestId: null,
    productId: Number(product.product_id),
    shopId: String(product.shop_id),
    externalProductId: String(product.external_product_id),
    productUrl: product.product_url,
    leaseUntil: product.lease_until,
  };
}

export async function claimStoreProduct(supabaseUrl, secret, excludedRequestIds = [], leaseUntil) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_oldest_store_collection_request`, {
    method: "POST",
    headers: adminHeaders(secret, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_excluded_request_ids: excludedRequestIds, p_lease_until: leaseUntil }),
  });
  if (!response.ok) throw new Error(`store_claim_${response.status}`);
  const [request] = await response.json();
  if (!request) return null;
  if (!request.request_id || !/^\d+$/.test(String(request.shop_id || ""))
    || !/^\d+$/.test(String(request.external_product_id || ""))
    || typeof request.product_url !== "string") throw new Error("invalid_store_product");
  return {
    claimSource: "store",
    queueRequestId: String(request.request_id),
    productId: null,
    shopId: String(request.shop_id),
    externalProductId: String(request.external_product_id),
    productUrl: request.product_url,
    leaseUntil: request.lease_until,
  };
}

async function claimPersonalProduct(supabaseUrl, secret, excludedProductIds, leaseUntil, skipSoldOut) {
  const rows = await rpc(supabaseUrl, secret, "claim_personal_collection_product", {
    p_excluded_product_ids: excludedProductIds,
    p_lease_until: leaseUntil,
    p_skip_sold_out: skipSoldOut,
  });
  const product = rows?.[0];
  if (!product) return null;
  return {
    claimSource: "personal", queueRequestId: null,
    productId: Number(product.product_id),
    shopId: String(product.shop_id), externalProductId: String(product.external_product_id),
    productUrl: product.product_url, leaseUntil: product.lease_until,
  };
}

async function advancePersonalProduct(supabaseUrl, secret, productId, days = 2) {
  const manila = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const next = new Date(Date.parse(`${manila}T00:00:00+08:00`) + days * 86400_000).toISOString();
  const response = await fetch(`${supabaseUrl}/rest/v1/personal_collection_products?product_id=eq.${productId}`, {
    method: "PATCH",
    headers: adminHeaders(secret, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ next_check_at: next, lease_until: null }),
  });
  if (!response.ok) throw new Error(`personal_advance_${response.status}`);
}

export async function claimNextProduct(supabaseUrl, secret, excludedProductIds = [], excludedRequestIds = [], leaseUntil, excludedStoreRequestIds = [], includeStoreImports = false, skipSoldOut = true, preferredSource = "store", includeNormalQueue = true, includePersonalQueue = false, includePriorityQueue = true) {
  if (includePersonalQueue) {
    const personal = await claimPersonalProduct(supabaseUrl, secret, excludedProductIds, leaseUntil, skipSoldOut);
    if (personal) return personal;
  }
  const priority = includePriorityQueue ? await claimPriorityProduct(supabaseUrl, secret, excludedRequestIds, leaseUntil) : null;
  if (priority) return priority;
  if (includeStoreImports && preferredSource === "store") {
    const store = await claimStoreProduct(supabaseUrl, secret, excludedStoreRequestIds, leaseUntil);
    if (store) return store;
  }
  const normal = includeNormalQueue
    ? await claimRandomProduct(supabaseUrl, secret, excludedProductIds, skipSoldOut)
    : null;
  if (normal || !includeStoreImports || preferredSource === "store") return normal;
  return claimStoreProduct(supabaseUrl, secret, excludedStoreRequestIds, leaseUntil);
}

export async function releasePriorityProduct(supabaseUrl, secret, requestId, leaseUntil) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/release_public_collection_request`, {
    method: "POST",
    headers: adminHeaders(secret, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_request_id: requestId, p_expected_lease_until: leaseUntil }),
  });
  if (!response.ok) throw new Error(`priority_release_${response.status}`);
}

export async function releaseStoreProduct(supabaseUrl, secret, requestId, leaseUntil) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/release_store_collection_request`, {
    method: "POST",
    headers: adminHeaders(secret, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_request_id: requestId, p_expected_lease_until: leaseUntil }),
  });
  if (!response.ok) throw new Error(`store_release_${response.status}`);
}

export async function collectorHistory(supabaseUrl, secret, offset = 0) {
  const limit = 200;
  const params = new URLSearchParams({
    select: "run_id,started_at,stopped_at,duration_seconds,succeeded,failed,sold_out,remaining,recheck_at,same_price,same_price_recheck_at,stop_status",
    order: "stopped_at.desc",
    limit: String(limit),
    offset: String(offset),
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/collector_run_history?${params}`, {
    headers: adminHeaders(secret),
  });
  if (!response.ok) throw new Error(`collector_history_${response.status}`);
  const rows = await response.json();
  return rows.map((row) => ({
    runId: row.run_id,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    durationSeconds: safeInteger(row.duration_seconds),
    succeeded: safeInteger(row.succeeded),
    failed: safeInteger(row.failed),
    soldOut: safeInteger(row.sold_out),
    remaining: safeInteger(row.remaining),
    recheckAt: typeof row.recheck_at === "string" ? row.recheck_at : null,
    samePrice: safeInteger(row.same_price),
    samePriceRecheckAt: typeof row.same_price_recheck_at === "string" ? row.same_price_recheck_at : null,
    stopStatus: ["stopped_safely", "interrupted", "login_expired", "api_failure", "confirmation_timeout"].includes(row.stop_status)
      ? row.stop_status
      : "stopped",
  }));
}

export async function saveCollectorRun(supabaseUrl, secret, run) {
  const response = await fetch(`${supabaseUrl}/rest/v1/collector_run_history?on_conflict=run_id`, {
    method: "POST",
    headers: adminHeaders(secret, {
      "Content-Type": "application/json",
      Prefer: "return=representation,resolution=merge-duplicates",
    }),
    body: JSON.stringify({
      run_id: String(run.runId),
      started_at: run.startedAt,
      stopped_at: run.stoppedAt,
      duration_seconds: safeInteger(run.durationSeconds),
      succeeded: safeInteger(run.succeeded),
      failed: safeInteger(run.failed),
      sold_out: safeInteger(run.soldOut),
      remaining: safeInteger(run.remaining),
      recheck_at: typeof run.recheckAt === "string" ? run.recheckAt : null,
      same_price: safeInteger(run.samePrice),
      same_price_recheck_at: typeof run.samePriceRecheckAt === "string" ? run.samePriceRecheckAt : null,
      stop_status: ["stopped_safely", "interrupted", "login_expired", "api_failure", "confirmation_timeout"].includes(run.stopStatus)
        ? run.stopStatus
        : "stopped",
    }),
  });
  if (!response.ok) throw new Error(`collector_finish_${response.status}`);
  const [saved] = await response.json();
  return saved;
}

async function releaseProduct(supabaseUrl, secret, productId) {
  const response = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${productId}`, {
    method: "PATCH",
    headers: adminHeaders(secret, {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    }),
    body: JSON.stringify({ check_lease_until: null }),
  });
  if (!response.ok) throw new Error(`release_${response.status}`);
}

function unchangedPriceRecheckAt(checkedAt) {
  const manilaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(checkedAt));
  return new Date(Date.parse(`${manilaDate}T00:00:00+08:00`) + 1 * 24 * 60 * 60_000).toISOString();
}

async function applyUnchangedPriceSkip(supabaseUrl, secret, productId, check, metadata) {
  const nextCheckAt = unchangedPriceRecheckAt(check.checked_at);
  const headers = adminHeaders(secret, { "Content-Type": "application/json", Prefer: "return=minimal" });
  const [checkResponse, productResponse] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/product_daily_checks?id=eq.${check.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ metadata: { ...metadata, skip_unchanged_day: true } }),
    }),
    fetch(`${supabaseUrl}/rest/v1/products?id=eq.${productId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ next_check_at: nextCheckAt }),
    }),
  ]);
  if (!checkResponse.ok) throw new Error(`same_price_check_${checkResponse.status}`);
  if (!productResponse.ok) throw new Error(`same_price_product_${productResponse.status}`);
  return nextCheckAt;
}

async function productCheckStatus(supabaseUrl, secret, productId, skipUnchangedDay = false, skipSoldOut = true, checkedDate = null) {
  const currentManilaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const params = new URLSearchParams({
    select: "id,checked_at,metadata",
    product_id: `eq.${productId}`,
    checked_date: `eq.${checkedDate || currentManilaDate}`,
    status: "eq.success",
    limit: "1",
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/product_daily_checks?${params}`, {
    headers: adminHeaders(secret),
  });
  if (!response.ok) throw new Error(`product_status_${response.status}`);
  const rows = await response.json();
  if (rows.length === 0) return { completed: false, checkedAt: null, soldOut: false, recheckAt: null, samePrice: false, samePriceRecheckAt: null };

  const productResponse = await fetch(
    `${supabaseUrl}/rest/v1/products?id=eq.${productId}&select=all_variations_sold_out,next_check_at&limit=1`,
    { headers: adminHeaders(secret) },
  );
  if (!productResponse.ok) throw new Error(`product_recheck_${productResponse.status}`);
  const [product] = await productResponse.json();
  const soldOut = product?.all_variations_sold_out === true;
  const metadata = rows[0]?.metadata;
  const samePrice = !soldOut && metadata?.all_variations_unchanged === true;
  const nextCheckAt = typeof product?.next_check_at === "string" ? product.next_check_at : null;
  const samePriceRecheckAt = samePrice && skipUnchangedDay
    ? await applyUnchangedPriceSkip(supabaseUrl, secret, productId, rows[0], metadata)
    : null;
  return {
    completed: true,
    checkedAt: rows[0].checked_at,
    soldOut,
    recheckAt: soldOut && skipSoldOut ? nextCheckAt : null,
    samePrice,
    samePriceRecheckAt,
  };
}

export async function productCheckStatusByIdentity(supabaseUrl, secret, shopId, externalProductId, skipUnchangedDay = false, skipSoldOut = true, checkedDate = null) {
  const params = new URLSearchParams({
    platform: "eq.shopee",
    external_shop_id: `eq.${shopId}`,
    external_product_id: `eq.${externalProductId}`,
    select: "id",
    limit: "1",
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/products?${params}`, { headers: adminHeaders(secret) });
  if (!response.ok) throw new Error(`priority_product_status_${response.status}`);
  const [product] = await response.json();
  if (!product) return { completed: false, checkedAt: null, soldOut: false, recheckAt: null, samePrice: false, samePriceRecheckAt: null };
  return productCheckStatus(supabaseUrl, secret, product.id, skipUnchangedDay, skipSoldOut, checkedDate);
}

export async function markCollectorProductOutcome(supabaseUrl, secret, payload) {
  return rpc(supabaseUrl, secret, "mark_collector_product_outcome", {
    p_claim_source: payload.claimSource,
    p_queue_request_id: payload.queueRequestId || null,
    p_product_id: payload.productId || null,
    p_external_shop_id: payload.shopId,
    p_external_product_id: payload.externalProductId,
    p_outcome: payload.outcome,
    p_checked_at: new Date().toISOString(),
  });
}

async function recordProduct(supabaseUrl, secret, publishableKey, payload) {
  const response = await fetch(`${supabaseUrl}/functions/v1/record-price`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      "Content-Type": "application/json",
      "x-pricetrack-internal-token": await digest(secret),
    },
    body: JSON.stringify({
      ...payload,
      source: "scheduled_collector",
      observedAt: new Date().toISOString(),
    }),
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: "Collector returned an invalid response" };
  }
  return { status: response.status, body };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  const expectedToken = process.env.ADMIN_HEALTH_TOKEN || "";
  const suppliedToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!secretsMatch(suppliedToken, expectedToken)) return send(res, 401, { error: "Unauthorized" });

  const declaredLength = safeInteger(req.headers["content-length"]);
  if (declaredLength > MAX_BODY_BYTES) return send(res, 413, { error: "Request body is too large" });

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
  const action = String(req.query.action || req.body?.action || "claim").toLowerCase();
  if (!supabaseUrl || !secret || (!action.startsWith("store-") && !publishableKey)) {
    return send(res, 503, { error: "PC collector is not configured" });
  }
  try {
    if (action === "store-list") {
      const select = "store_id,store_key,store_url,display_name,first_added_at,last_scan_started_at,last_scan_finished_at,last_scan_status,last_discovered,last_newly_queued,last_duplicate,last_already_tracked";
      const response = await fetch(`${supabaseUrl}/rest/v1/collection_stores?select=${select}&order=first_added_at.desc`, {
        headers: adminHeaders(secret),
      });
      if (!response.ok) throw new Error(`store_list_${response.status}`);
      return send(res, 200, { ok: true, stores: (await response.json()).map(mapStore) });
    }

    if (action === "store-history") {
      const offset = Math.max(0, safeInteger(req.body?.offset));
      const limit = 200;
      const status = String(req.body?.status || "all").toLowerCase();
      if (!["all", "completed", "incomplete", "interrupted"].includes(status)) {
        return send(res, 400, { error: "Invalid store scan status" });
      }
      const query = String(req.body?.query || "").trim().slice(0, 100);
      const params = new URLSearchParams({
        select: "scan_id,store_id,started_at,finished_at,status,discovered,newly_queued,duplicate,already_tracked,sold_out,pages_current,pages_total,collection_stores!inner(store_url,display_name)",
        order: "started_at.desc,scan_id.desc",
        limit: String(limit),
        offset: String(offset),
      });
      if (status !== "all") params.set("status", `eq.${status}`);
      if (query) params.set("collection_stores.display_name", `ilike.*${query}*`);
      const response = await fetch(`${supabaseUrl}/rest/v1/store_scan_history?${params}`, {
        headers: adminHeaders(secret, { Prefer: "count=exact" }),
      });
      if (!response.ok) throw new Error(`store_history_${response.status}`);
      const scans = (await response.json()).map(mapStoreScan);
      return send(res, 200, { ok: true, scans, hasMore: scans.length === limit });
    }

    if (action.startsWith("store-")) {
      const scanId = String(req.body?.scanId || "");
      if (!UUID_V4.test(scanId)) return send(res, 400, { error: "A valid store scan is required" });

      if (action === "store-begin") {
        const store = normalizeShopeeStoreUrl(String(req.body?.storeUrl || ""));
        if (!store) return send(res, 400, { error: "Enter a valid Shopee Philippines store URL" });
        const storeId = await rpc(supabaseUrl, secret, "begin_store_collection_scan", {
          p_store_key: store.storeKey,
          p_store_url: store.storeUrl,
          p_display_name: store.displayName,
          p_scan_id: scanId,
        });
        return send(res, 200, { ok: true, storeId, store });
      }

      if (action === "store-batch") {
        const products = normalizeDiscoveredProducts(req.body?.products);
        if (products.length === 0) return send(res, 400, { error: "No valid Shopee products were found" });
        const pagesCurrent = safeInteger(req.body?.pagesCurrent);
        const pagesTotal = safeInteger(req.body?.pagesTotal);
        if (pagesTotal > 0 && pagesCurrent > pagesTotal) return send(res, 400, { error: "Invalid store page progress" });
        const totals = await rpc(supabaseUrl, secret, "import_store_collection_batch", {
          p_scan_id: scanId,
          p_products: products,
          p_pages_current: pagesCurrent,
          p_pages_total: pagesTotal,
        });
        await rpc(supabaseUrl, secret, "upsert_store_listing_metadata", {
          p_scan_id: scanId,
          p_products: products,
        });
        return send(res, 200, { ok: true, totals });
      }

      if (action === "store-finish" || action === "store-fail") {
        const requestedStatus = action === "store-fail" ? "interrupted" : String(req.body?.status || "completed");
        const status = requestedStatus === "incomplete" ? "incomplete" : action === "store-fail" ? "interrupted" : "completed";
        const pagesCurrent = safeInteger(req.body?.pagesCurrent);
        const pagesTotal = safeInteger(req.body?.pagesTotal);
        if (pagesTotal > 0 && pagesCurrent > pagesTotal) return send(res, 400, { error: "Invalid store page progress" });
        const result = await rpc(supabaseUrl, secret, "finish_store_collection_scan", {
          p_scan_id: scanId,
          p_status: status,
          p_pages_current: pagesCurrent,
          p_pages_total: pagesTotal,
        });
        return send(res, 200, { ok: true, result });
      }
    }

    if (action === "summary") {
      return send(res, 200, { ok: true, ...(await collectorSummary(supabaseUrl, secret)) });
    }

    if (action === "bootstrap") {
      const [summary, history] = await Promise.all([
        collectorSummary(supabaseUrl, secret),
        collectorHistory(supabaseUrl, secret, 0),
      ]);
      return send(res, 200, { ok: true, ...summary, history, hasMore: history.length === 200 });
    }

    if (action === "history") {
      const offset = Math.max(0, safeInteger(req.body?.offset));
      const history = await collectorHistory(supabaseUrl, secret, offset);
      return send(res, 200, { ok: true, history, hasMore: history.length === 200 });
    }

    if (action === "finish") {
      const run = req.body?.run;
      if (!run || typeof run !== "object" || Array.isArray(run) || !/^[0-9a-f-]{36}$/i.test(String(run.runId || ""))) {
        return send(res, 400, { error: "A valid collector run is required" });
      }
      const liveSummary = await collectorSummary(supabaseUrl, secret);
      const finishedRun = { ...run, remaining: liveSummary.totalDue };
      await saveCollectorRun(supabaseUrl, secret, finishedRun);
      return send(res, 200, { ok: true, saved: finishedRun });
    }

    if (action === "personal-list") {
      const response = await fetch(`${supabaseUrl}/rest/v1/personal_collection_products?select=product_id,added_at,next_check_at,products(product_url,external_shop_id,external_product_id)&order=added_at.desc`, {
        headers: adminHeaders(secret),
      });
      if (!response.ok) throw new Error(`personal_list_${response.status}`);
      return send(res, 200, { ok: true, favorites: await response.json() });
    }

    if (action === "personal-add") {
      let parsed;
      try { parsed = new URL(String(req.body?.productUrl || "")); } catch { return send(res, 400, { error: "Enter a valid Shopee product link." }); }
      const identity = parsed.pathname.match(/^\/product\/(\d+)\/(\d+)\/?$/) || parsed.pathname.match(/-i\.(\d+)\.(\d+)\/?$/);
      if (parsed.protocol !== "https:" || parsed.hostname !== "shopee.ph" || !identity) {
        return send(res, 400, { error: "Enter a Shopee product link with a shop and product ID." });
      }
      const params = new URLSearchParams({ select: "id", platform: "eq.shopee", external_shop_id: `eq.${identity[1]}`, external_product_id: `eq.${identity[2]}`, limit: "1" });
      const matchResponse = await fetch(`${supabaseUrl}/rest/v1/products?${params}`, { headers: adminHeaders(secret) });
      if (!matchResponse.ok) throw new Error(`personal_product_${matchResponse.status}`);
      const [product] = await matchResponse.json();
      if (!product) return send(res, 404, { error: "This product is not tracked yet. Record it first, then add it here." });
      const response = await fetch(`${supabaseUrl}/rest/v1/personal_collection_products?on_conflict=product_id`, {
        method: "POST",
        headers: adminHeaders(secret, { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" }),
        body: JSON.stringify({ product_id: product.id }),
      });
      if (!response.ok) throw new Error(`personal_add_${response.status}`);
      return send(res, 200, { ok: true });
    }

    if (action === "personal-add-current") {
      const shopId = String(req.body?.shopId || "");
      const externalProductId = String(req.body?.externalProductId || "");
      if (!/^\d+$/.test(shopId) || !/^\d+$/.test(externalProductId)) {
        return send(res, 400, { error: "A valid current product is required." });
      }
      const params = new URLSearchParams({ select: "id", platform: "eq.shopee", external_shop_id: `eq.${shopId}`, external_product_id: `eq.${externalProductId}`, limit: "1" });
      const matchResponse = await fetch(`${supabaseUrl}/rest/v1/products?${params}`, { headers: adminHeaders(secret) });
      if (!matchResponse.ok) throw new Error(`personal_product_${matchResponse.status}`);
      const [product] = await matchResponse.json();
      if (!product) return send(res, 404, { error: "This product is not tracked yet. Try again after it is recorded." });
      const response = await fetch(`${supabaseUrl}/rest/v1/personal_collection_products?on_conflict=product_id`, {
        method: "POST",
        headers: adminHeaders(secret, { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" }),
        body: JSON.stringify({ product_id: product.id }),
      });
      if (!response.ok) throw new Error(`personal_add_${response.status}`);
      return send(res, 200, { ok: true });
    }

    if (action === "personal-remove-current") {
      const shopId = String(req.body?.shopId || "");
      const externalProductId = String(req.body?.externalProductId || "");
      if (!/^\\d+$/.test(shopId) || !/^\\d+$/.test(externalProductId)) {
        return send(res, 400, { error: "A valid current product is required." });
      }
      const params = new URLSearchParams({ select: "id", platform: "eq.shopee", external_shop_id: `eq.${shopId}`, external_product_id: `eq.${externalProductId}`, limit: "1" });
      const matchResponse = await fetch(`${supabaseUrl}/rest/v1/products?${params}`, { headers: adminHeaders(secret) });
      if (!matchResponse.ok) throw new Error(`personal_product_${matchResponse.status}`);
      const [product] = await matchResponse.json();
      if (product) {
        const response = await fetch(`${supabaseUrl}/rest/v1/personal_collection_products?product_id=eq.${product.id}`, {
          method: "DELETE", headers: adminHeaders(secret, { Prefer: "return=minimal" }),
        });
        if (!response.ok) throw new Error(`personal_remove_${response.status}`);
      }
      return send(res, 200, { ok: true });
    }

    if (action === "personal-remove") {
      const productId = safeInteger(req.body?.productId);
      if (!productId) return send(res, 400, { error: "A valid saved product is required" });
      const response = await fetch(`${supabaseUrl}/rest/v1/personal_collection_products?product_id=eq.${productId}`, {
        method: "DELETE", headers: adminHeaders(secret, { Prefer: "return=minimal" }),
      });
      if (!response.ok) throw new Error(`personal_remove_${response.status}`);
      return send(res, 200, { ok: true });
    }

    if (action === "claim") {
      const attemptedProductIds = Array.isArray(req.body?.attemptedProductIds)
        ? req.body.attemptedProductIds.map((value) => safeInteger(value)).filter(Boolean).slice(0, 5000)
        : [];
      const attemptedQueueRequestIds = Array.isArray(req.body?.attemptedQueueRequestIds)
        ? req.body.attemptedQueueRequestIds.map(String).filter(Boolean).slice(0, 5000)
        : [];
      const attemptedStoreRequestIds = Array.isArray(req.body?.attemptedStoreRequestIds)
        ? req.body.attemptedStoreRequestIds.map(String).filter(Boolean).slice(0, 5000)
        : [];
      const leaseUntil = new Date(Date.now() + 5 * 60_000).toISOString();
      const product = await claimNextProduct(
        supabaseUrl, secret, attemptedProductIds, attemptedQueueRequestIds, leaseUntil,
        attemptedStoreRequestIds, req.body?.includeStoreImports === true, req.body?.skipSoldOut !== false,
        req.body?.preferredSource === "normal" ? "normal" : "store",
        req.body?.includeNormalQueue !== false,
        req.body?.includePersonalQueue === true,
        req.body?.includePriorityQueue !== false,
      );
      return send(res, 200, { ok: true, product });
    }

    if (action === "reclaim") {
      const product = req.body?.product;
      if (!product || !["priority", "store", "random"].includes(product.claimSource)
        || !/^\d+$/.test(String(product.shopId || "")) || !/^\d+$/.test(String(product.externalProductId || ""))) {
        return send(res, 400, { error: "A valid retry product is required" });
      }
      const leaseUntil = new Date(Date.now() + 5 * 60_000).toISOString();
      const claimed = await rpc(supabaseUrl, secret, "reclaim_collector_product", {
        p_claim_source: product.claimSource,
        p_queue_request_id: product.queueRequestId || null,
        p_product_id: product.productId || null,
        p_external_shop_id: product.shopId,
        p_external_product_id: product.externalProductId,
        p_lease_until: leaseUntil,
      });
      return send(res, 200, { ok: true, product: claimed ? { ...product, leaseUntil } : null });
    }

    if (action === "release") {
      if (req.body?.claimSource === "personal") {
        const productId = safeInteger(req.body?.productId);
        if (!productId) return send(res, 400, { error: "A valid saved product is required" });
        const response = await fetch(`${supabaseUrl}/rest/v1/personal_collection_products?product_id=eq.${productId}`, {
          method: "PATCH", headers: adminHeaders(secret, { "Content-Type": "application/json", Prefer: "return=minimal" }),
          body: JSON.stringify({ lease_until: null }),
        });
        if (!response.ok) throw new Error(`personal_release_${response.status}`);
        await releaseProduct(supabaseUrl, secret, productId);
        return send(res, 200, { ok: true });
      }
      if (req.body?.claimSource === "store") {
        const queueRequestId = String(req.body?.queueRequestId || "");
        const leaseUntil = String(req.body?.leaseUntil || "");
        if (!queueRequestId || !leaseUntil) return send(res, 400, { error: "A valid store lease is required" });
        await releaseStoreProduct(supabaseUrl, secret, queueRequestId, leaseUntil);
        return send(res, 200, { ok: true });
      }
      if (req.body?.claimSource === "priority") {
        const queueRequestId = String(req.body?.queueRequestId || "");
        const leaseUntil = String(req.body?.leaseUntil || "");
        if (!queueRequestId || !leaseUntil) return send(res, 400, { error: "A valid priority lease is required" });
        await releasePriorityProduct(supabaseUrl, secret, queueRequestId, leaseUntil);
        return send(res, 200, { ok: true });
      }
      const productId = safeInteger(req.body?.productId);
      if (!productId) return send(res, 400, { error: "A valid product ID is required" });
      await releaseProduct(supabaseUrl, secret, productId);
      return send(res, 200, { ok: true });
    }

    if (action === "status") {
      const skipUnchangedDay = req.body?.skipUnchangedDay === true;
      const skipSoldOut = req.body?.skipSoldOut !== false;
      const requestedCheckDate = String(req.body?.checkedDate || "");
      const checkedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedCheckDate) ? requestedCheckDate : null;
      const productId = safeInteger(req.body?.productId);
      if (productId) {
        const status = await productCheckStatus(supabaseUrl, secret, productId, skipUnchangedDay, skipSoldOut, checkedDate);
        if (status.completed && req.body?.claimSource === "personal") {
          await advancePersonalProduct(supabaseUrl, secret, productId);
        }
        return send(res, 200, { ok: true, ...status });
      }
      const shopId = String(req.body?.shopId || "");
      const externalProductId = String(req.body?.externalProductId || "");
      if (!/^\d+$/.test(shopId) || !/^\d+$/.test(externalProductId)) {
        return send(res, 400, { error: "A valid product identity is required" });
      }
      return send(res, 200, {
        ok: true,
        ...(await productCheckStatusByIdentity(supabaseUrl, secret, shopId, externalProductId, skipUnchangedDay, skipSoldOut, checkedDate)),
      });
    }

    if (action === "outcome") {
      const claimSource = String(req.body?.claimSource || "");
      const queueRequestId = String(req.body?.queueRequestId || "");
      const productId = safeInteger(req.body?.productId);
      const shopId = String(req.body?.shopId || "");
      const externalProductId = String(req.body?.externalProductId || "");
      const outcome = String(req.body?.outcome || "");
      if (!["priority", "store", "random", "personal"].includes(claimSource)
        || !["sold_out", "does_not_exist", "unlisted", "page_error"].includes(outcome)
        || !/^\d+$/.test(shopId) || !/^\d+$/.test(externalProductId)
        || (["random", "personal"].includes(claimSource) && !productId)
        || (!["random", "personal"].includes(claimSource) && !UUID_V4.test(queueRequestId))) {
        return send(res, 400, { error: "A valid collector product outcome is required" });
      }
      const result = await markCollectorProductOutcome(supabaseUrl, secret, {
        claimSource: claimSource === "personal" ? "random" : claimSource, queueRequestId: queueRequestId || null, productId: productId || null,
        shopId, externalProductId, outcome,
      });
      if (claimSource === "personal") await advancePersonalProduct(supabaseUrl, secret, productId, outcome === "page_error" ? 1 : 2);
      return send(res, 200, { ok: true, result: claimSource === "personal" ? { ...result, retryAfterCurrentRun: false } : result });
    }

    if (action === "record") {
      const payload = req.body?.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return send(res, 400, { error: "A valid observation payload is required" });
      }
      const result = await recordProduct(supabaseUrl, secret, publishableKey, payload);
      return send(res, result.status, result.body);
    }

    return send(res, 400, { error: "Unknown collector action" });
  } catch (error) {
    console.error("PC collector API failed", error);
    return send(res, 502, { error: "Unable to complete the PC collector request" });
  }
}
