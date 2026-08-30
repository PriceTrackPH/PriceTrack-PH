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

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "PATCH") {
    return send(res, 405, { error: "Method not allowed" });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !secret) return send(res, 503, { error: "Site settings are not configured" });

  const publisherId = String(process.env.ADSENSE_PUBLISHER_ID || "").trim();
  const reportSlotId = String(process.env.ADSENSE_REPORT_SLOT_ID || "").trim();
  const configured = /^ca-pub-\d+$/.test(publisherId) && /^\d+$/.test(reportSlotId);
  const headers = adminHeaders(secret, { "Content-Type": "application/json" });

  try {
    if (req.method === "PATCH") {
      const expectedToken = process.env.ADMIN_HEALTH_TOKEN || "";
      const suppliedToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!secretsMatch(suppliedToken, expectedToken)) return send(res, 401, { error: "Unauthorized" });
      if (typeof req.body?.adsEnabled !== "boolean") return send(res, 400, { error: "adsEnabled must be true or false" });

      const updateResponse = await fetch(`${supabaseUrl}/rest/v1/site_settings?key=eq.ads_enabled`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({ boolean_value: req.body.adsEnabled, updated_at: new Date().toISOString() }),
      });
      if (!updateResponse.ok) throw new Error(`settings_update_${updateResponse.status}`);
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/site_settings?key=eq.ads_enabled&select=boolean_value,updated_at`, { headers });
    if (!response.ok) throw new Error(`settings_read_${response.status}`);
    const [row] = await response.json();
    const requestedEnabled = row?.boolean_value === true;

    return send(res, 200, {
      adsEnabled: requestedEnabled && configured,
      requestedEnabled,
      configured,
      publisherId: configured ? publisherId : null,
      reportSlotId: configured ? reportSlotId : null,
      updatedAt: row?.updated_at || null,
    });
  } catch (error) {
    console.error("Site settings request failed", error);
    return send(res, 502, { error: "Unable to load site settings" });
  }
}
