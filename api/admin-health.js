import crypto from "node:crypto";

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
    const cleanupResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/delete_expired_diagnostic_events`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!cleanupResponse.ok) throw new Error(`cleanup_${cleanupResponse.status}`);

    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const recentParams = new URLSearchParams({
      select: "id,created_at,event_type,source,shop_id,product_id,variation_count,recorded_count,unchanged_count,failed_count,status_code,error_code,details",
      created_at: `gte.${since}`,
      order: "created_at.desc",
      limit: "50",
    });

    const [recentResponse, total, failures, partial, duplicates, variationChanges] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/diagnostic_events?${recentParams}`, { headers }),
      fetchCount(supabaseUrl, headers),
      fetchCount(supabaseUrl, headers, "record_failure"),
      fetchCount(supabaseUrl, headers, "record_partial"),
      fetchCount(supabaseUrl, headers, "duplicate_blocked"),
      fetchCount(supabaseUrl, headers, "variation_count_changed"),
    ]);

    if (!recentResponse.ok) throw new Error(`events_${recentResponse.status}`);
    const events = await recentResponse.json();
    const lastSuccess = events.find((event) => event.event_type === "record_success")?.created_at || null;

    return send(res, 200, {
      windowDays: 30,
      generatedAt: new Date().toISOString(),
      summary: { total, failures, partial, duplicates, variationChanges, lastSuccess },
      events,
    });
  } catch (error) {
    console.error("Admin health query failed", error);
    return send(res, 502, { error: "Unable to load diagnostics" });
  }
}
