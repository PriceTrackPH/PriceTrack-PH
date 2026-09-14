import crypto from "node:crypto";

function send(res, status, body) {
  res.status(status).setHeader("Cache-Control", status === 200 ? "private, max-age=15" : "no-store").json(body);
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

async function fetchCount(baseUrl, headers, eventType) {
  const params = new URLSearchParams({ select: "id", created_at: `gte.${new Date(Date.now() - 30 * 864e5).toISOString()}` });
  if (eventType) params.set("event_type", `eq.${eventType}`);
  const response = await fetch(`${baseUrl}/rest/v1/diagnostic_events?${params}`, {
    headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
  });
  if (!response.ok) throw new Error(`count_${response.status}`);
  const range = response.headers.get("content-range") || "*/0";
  return Number(range.split("/")[1]) || 0;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });

  const expectedToken = process.env.ADMIN_HEALTH_TOKEN || "";
  const suppliedToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!secretsMatch(suppliedToken, expectedToken)) return send(res, 401, { error: "Unauthorized" });

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !secret) return send(res, 503, { error: "Health monitor is not configured" });

  try {
    const headers = adminHeaders(secret);
    const offset = Math.max(0, Number.parseInt(String(req.query.offset || "0"), 10) || 0);
    const limit = 200;
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const recentParams = new URLSearchParams({
      select: "id,created_at,event_type,source,shop_id,product_id,variation_count,recorded_count,unchanged_count,failed_count,status_code,error_code,details",
      created_at: `gte.${since}`,
      order: "created_at.desc",
      limit: String(limit),
      offset: String(offset),
    });
    if (offset > 0) {
      const recentResponse = await fetch(`${supabaseUrl}/rest/v1/diagnostic_events?${recentParams}`, { headers });
      if (!recentResponse.ok) throw new Error(`events_${recentResponse.status}`);
      const events = await recentResponse.json();
      return send(res, 200, { events, hasMore: events.length === limit });
    }
    const snapshotResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/admin_health_snapshot`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ p_limit: limit }),
    });
    if (!snapshotResponse.ok) throw new Error(`snapshot_${snapshotResponse.status}`);
    return send(res, 200, await snapshotResponse.json());
  } catch (error) {
    console.error("Admin health query failed", error);
    return send(res, 502, { error: "Unable to load diagnostics" });
  }
}
