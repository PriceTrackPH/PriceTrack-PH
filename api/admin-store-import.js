import crypto from "node:crypto";
import { normalizeDiscoveredProducts, normalizeShopeeStoreUrl } from "../src/store-import-contract.ts";

const MAX_BODY_BYTES = 512_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function send(res, status, body) {
  return res.status(status).setHeader("Cache-Control", "no-store").json(body);
}

function secretsMatch(actual, expected) {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function serviceHeaders(secret, extra = {}) {
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

async function rpc(supabaseUrl, secret, name, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: serviceHeaders(secret, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${name}_${response.status}`);
  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const expectedToken = process.env.ADMIN_HEALTH_TOKEN || "";
  const suppliedToken = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!secretsMatch(suppliedToken, expectedToken)) return send(res, 401, { error: "Unauthorized" });
  const declaredLength = Number(req.headers?.["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return send(res, 413, { error: "Request body is too large" });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !secret) return send(res, 503, { error: "Store import is not configured" });
  const action = String(req.query?.action || req.body?.action || "list").toLowerCase();

  try {
    if (action === "list") {
      const select = "store_id,store_key,store_url,display_name,first_added_at,last_scan_started_at,last_scan_finished_at,last_scan_status,last_discovered,last_newly_queued,last_duplicate,last_already_tracked";
      const response = await fetch(`${supabaseUrl}/rest/v1/collection_stores?select=${select}&order=first_added_at.desc`, {
        headers: serviceHeaders(secret),
      });
      if (!response.ok) throw new Error(`store_list_${response.status}`);
      return send(res, 200, { ok: true, stores: (await response.json()).map(mapStore) });
    }

    const scanId = String(req.body?.scanId || "");
    if (!UUID_V4.test(scanId)) return send(res, 400, { error: "A valid store scan is required" });

    if (action === "begin") {
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

    if (action === "batch") {
      const products = normalizeDiscoveredProducts(req.body?.products);
      if (products.length === 0) return send(res, 400, { error: "No valid Shopee products were found" });
      const totals = await rpc(supabaseUrl, secret, "import_store_collection_batch", {
        p_scan_id: scanId,
        p_products: products,
      });
      return send(res, 200, { ok: true, totals });
    }

    if (action === "finish" || action === "fail") {
      const requestedStatus = action === "fail" ? "failed" : String(req.body?.status || "completed");
      const status = requestedStatus === "incomplete" ? "incomplete" : action === "fail" ? "failed" : "completed";
      const result = await rpc(supabaseUrl, secret, "finish_store_collection_scan", {
        p_scan_id: scanId,
        p_status: status,
      });
      return send(res, 200, { ok: true, result });
    }

    return send(res, 400, { error: "Unknown store import action" });
  } catch (error) {
    console.error("Store import failed", error instanceof Error ? error.message : "unknown");
    return send(res, 502, { error: "Unable to complete the store import request" });
  }
}
