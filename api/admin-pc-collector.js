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

async function countProducts(supabaseUrl, secret, filters) {
  const params = new URLSearchParams({
    select: "id",
    platform: "eq.shopee",
    is_active: "eq.true",
    tracking_enabled: "eq.true",
    ...filters,
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/products?${params}`, {
    method: "HEAD",
    headers: adminHeaders(secret, { Prefer: "count=exact", Range: "0-0" }),
  });
  if (!response.ok) throw new Error(`product_count_${response.status}`);
  const total = Number(String(response.headers.get("content-range") || "").split("/")[1]);
  return Number.isSafeInteger(total) && total >= 0 ? total : 0;
}

async function collectorSummary(supabaseUrl, secret) {
  const now = new Date().toISOString();
  const [totalDue, soldOutDeferred] = await Promise.all([
    countProducts(supabaseUrl, secret, { next_check_at: `lte.${now}` }),
    countProducts(supabaseUrl, secret, {
      all_variations_sold_out: "eq.true",
      next_check_at: `gt.${now}`,
    }),
  ]);
  return { totalDue, soldOutDeferred };
}

async function claimNextProduct(supabaseUrl, secret, afterProductId) {
  const now = new Date();
  const params = new URLSearchParams({
    select: "id,external_shop_id,external_product_id,product_url",
    platform: "eq.shopee",
    is_active: "eq.true",
    tracking_enabled: "eq.true",
    next_check_at: `lte.${now.toISOString()}`,
    id: `gt.${afterProductId}`,
    or: `(check_lease_until.is.null,check_lease_until.lt.${now.toISOString()})`,
    order: "id.asc",
    limit: "1",
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/products?${params}`, {
    headers: adminHeaders(secret),
  });
  if (!response.ok) throw new Error(`due_lookup_${response.status}`);
  const [product] = await response.json();
  if (!product) return null;
  if (!validProduct(product)) throw new Error("invalid_due_product");

  const leaseUntil = new Date(Date.now() + 10 * 60_000).toISOString();
  const leaseResponse = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${product.id}`, {
    method: "PATCH",
    headers: adminHeaders(secret, {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    }),
    body: JSON.stringify({
      check_lease_until: leaseUntil,
      last_check_attempt_at: now.toISOString(),
    }),
  });
  if (!leaseResponse.ok) throw new Error(`lease_${leaseResponse.status}`);

  return {
    productId: Number(product.id),
    shopId: String(product.external_shop_id),
    externalProductId: String(product.external_product_id),
    productUrl: product.product_url,
    leaseUntil,
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
      const afterProductId = safeInteger(req.body?.afterProductId);
      const product = await claimNextProduct(supabaseUrl, secret, afterProductId);
      return send(res, 200, { ok: true, product });
    }

    if (action === "release") {
      const productId = safeInteger(req.body?.productId);
      if (!productId) return send(res, 400, { error: "A valid product ID is required" });
      await releaseProduct(supabaseUrl, secret, productId);
      return send(res, 200, { ok: true });
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
