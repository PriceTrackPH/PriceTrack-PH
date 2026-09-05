import crypto from "node:crypto";

const MAX_BODY_BYTES = 8_192;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_ID = /^\d+$/;

const queuedMessage = "This product hasn't been tracked yet. It has been added to the PriceTrack collection queue and will be checked soon.";
const limitMessage = "You've reached today's 100-product request limit. You can request more products tomorrow.";

function send(res, status, body) {
  return res.status(status).setHeader("Cache-Control", "no-store").json(body);
}

export function isMobileRequest(headers = {}) {
  if (String(headers["sec-ch-ua-mobile"] || "").trim() === "?1") return true;
  return /(Android|iPhone|iPad|iPod|Mobile)/i.test(String(headers["user-agent"] || ""));
}

export function manilaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function validateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const shopId = String(body.shopId || "");
  const productId = String(body.productId || "");
  const productUrl = String(body.productUrl || "");
  const deviceId = String(body.deviceId || "");
  if (!NUMERIC_ID.test(shopId) || !NUMERIC_ID.test(productId) || !UUID_V4.test(deviceId)) return null;

  try {
    const parsed = new URL(productUrl);
    const expectedPath = `/product/${shopId}/${productId}`;
    if (parsed.protocol !== "https:" || parsed.hostname !== "shopee.ph" || parsed.pathname !== expectedPath) return null;
  } catch {
    return null;
  }
  return { shopId, productId, productUrl, deviceId };
}

function serviceHeaders(secret) {
  const headers = { apikey: secret, "Content-Type": "application/json" };
  if (secret.startsWith("ey")) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!isMobileRequest(req.headers)) return send(res, 403, { error: "Mobile requests only" });

  const declaredLength = Number(req.headers?.["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return send(res, 413, { error: "Request body is too large" });
  }
  const body = validateBody(req.body);
  if (!body) return send(res, 400, { error: "A valid Shopee product request is required" });

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !secret) return send(res, 503, { error: "Collection queue is unavailable" });

  const requesterHash = crypto.createHash("sha256").update(body.deviceId).digest("hex");
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/enqueue_public_collection_request`, {
      method: "POST",
      headers: serviceHeaders(secret),
      body: JSON.stringify({
        p_requester_hash: requesterHash,
        p_external_shop_id: body.shopId,
        p_external_product_id: body.productId,
        p_product_url: body.productUrl,
        p_requested_date: manilaDate(),
      }),
    });
    if (!response.ok) throw new Error(`queue_${response.status}`);
    const result = await response.json();
    const status = Array.isArray(result) ? result[0]?.status : result?.status;
    if (status === "queued" || status === "duplicate") {
      return send(res, 200, { status, message: queuedMessage });
    }
    if (status === "limit_reached") {
      return send(res, 429, { status, error: limitMessage });
    }
    throw new Error("queue_invalid_response");
  } catch (error) {
    console.error("Public collection request failed", error instanceof Error ? error.message : "unknown");
    return send(res, 503, { error: "Unable to add this product to the collection queue. Please try again." });
  }
}
