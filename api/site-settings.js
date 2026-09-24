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
  const topSlotId = String(process.env.ADSENSE_TOP_SLOT_ID || "").trim();
  const configured = /^ca-pub-\d+$/.test(publisherId) && /^\d+$/.test(reportSlotId);
  const topSlotConfigured = /^ca-pub-\d+$/.test(publisherId) && /^\d+$/.test(topSlotId);
  const headers = adminHeaders(secret, { "Content-Type": "application/json" });

  try {
    const settingKeys = {
      adsEnabled: "ads_enabled",
      shopeeLinkEnabled: "shopee_link_enabled",
      affiliateLinkEnabled: "affiliate_link_enabled",
    };

    if (req.method === "PATCH") {
      const expectedToken = process.env.ADMIN_HEALTH_TOKEN || "";
      const suppliedToken = String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
      if (!secretsMatch(suppliedToken, expectedToken)) return send(res, 401, { error: "Unauthorized" });

      const changes = Object.entries(settingKeys).filter(([field]) => Object.prototype.hasOwnProperty.call(req.body || {}, field));
      if (changes.length !== 1 || typeof req.body[changes[0][0]] !== "boolean") {
        return send(res, 400, { error: "Supply one boolean setting" });
      }
      const [field, key] = changes[0];
      const updateResponse = await fetch(`${supabaseUrl}/rest/v1/site_settings?on_conflict=key`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ key, boolean_value: req.body[field], updated_at: new Date().toISOString() }),
      });
      if (!updateResponse.ok) throw new Error(`settings_update_${updateResponse.status}`);
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/site_settings?key=in.(ads_enabled,shopee_link_enabled,affiliate_link_enabled)&select=key,boolean_value,updated_at`, { headers });
    if (!response.ok) throw new Error(`settings_read_${response.status}`);
    const rows = await response.json();
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    const requestedEnabled = byKey.ads_enabled?.boolean_value === true;

    return send(res, 200, {
      adsEnabled: requestedEnabled && configured,
      requestedEnabled,
      shopeeLinkEnabled: byKey.shopee_link_enabled?.boolean_value !== false,
      affiliateLinkEnabled: byKey.affiliate_link_enabled?.boolean_value !== false,
      configured,
      publisherId: configured ? publisherId : null,
      reportSlotId: configured ? reportSlotId : null,
      topSlotId: topSlotConfigured ? topSlotId : null,
      updatedAt: byKey.ads_enabled?.updated_at || null,
    });
  } catch (error) {
    console.error("Site settings request failed", error);
    return send(res, 502, { error: "Unable to load site settings" });
  }
}
