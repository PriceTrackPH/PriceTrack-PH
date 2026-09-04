import crypto from "node:crypto";

const MAX_BODY_BYTES = 512_000;

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
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/collector_available_summary`, {
    method: "POST",
    headers: adminHeaders(secret, { "Content-Type": "application/json" }),
    body: "{}",
  });
  if (!response.ok) throw new Error(`collector_summary_${response.status}`);
  const [summary] = await response.json();
  return {
    totalTracked: safeInteger(summary?.total_tracked),
    totalDue: safeInteger(summary?.total_due),
    soldOutDeferred: safeInteger(summary?.sold_out_deferred),
  };
}

export async function claimRandomProduct(supabaseUrl, secret, excludedProductIds = []) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_random_available_product_check`, {
    method: "POST",
    headers: adminHeaders(secret, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_excluded_product_ids: excludedProductIds }),
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
    productId: Number(product.product_id),
    shopId: String(product.shop_id),
    externalProductId: String(product.external_product_id),
    productUrl: product.product_url,
    leaseUntil: product.lease_until,
  };
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

async function productCheckStatus(supabaseUrl, secret, productId) {
  const manilaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const params = new URLSearchParams({
    select: "id,checked_at",
    product_id: `eq.${productId}`,
    checked_date: `eq.${manilaDate}`,
    status: "eq.success",
    limit: "1",
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/product_daily_checks?${params}`, {
    headers: adminHeaders(secret),
  });
  if (!response.ok) throw new Error(`product_status_${response.status}`);
  const rows = await response.json();
  return { completed: rows.length > 0, checkedAt: rows[0]?.checked_at || null };
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
  if (!supabaseUrl || !secret || !publishableKey) {
    return send(res, 503, { error: "PC collector is not configured" });
  }

  const action = String(req.query.action || req.body?.action || "claim").toLowerCase();
  try {
    if (action === "summary") {
      return send(res, 200, { ok: true, ...(await collectorSummary(supabaseUrl, secret)) });
    }

    if (action === "claim") {
      const attemptedProductIds = Array.isArray(req.body?.attemptedProductIds)
        ? req.body.attemptedProductIds.map((value) => safeInteger(value)).filter(Boolean).slice(0, 5000)
        : [];
      const product = await claimRandomProduct(supabaseUrl, secret, attemptedProductIds);
      return send(res, 200, { ok: true, product });
    }

    if (action === "release") {
      const productId = safeInteger(req.body?.productId);
      if (!productId) return send(res, 400, { error: "A valid product ID is required" });
      await releaseProduct(supabaseUrl, secret, productId);
      return send(res, 200, { ok: true });
    }

    if (action === "status") {
      const productId = safeInteger(req.body?.productId);
      if (!productId) return send(res, 400, { error: "A valid product ID is required" });
      return send(res, 200, { ok: true, ...(await productCheckStatus(supabaseUrl, secret, productId)) });
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
