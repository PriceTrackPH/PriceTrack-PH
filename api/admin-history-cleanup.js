import crypto from "node:crypto";

const matches = (actual, expected) => {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!matches(token, process.env.CRON_SECRET || "")) return res.status(401).json({ error: "Unauthorized" });
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !secret) return res.status(503).json({ error: "Cleanup is not configured" });
  const headers = { apikey: secret, "Content-Type": "application/json", ...(secret.startsWith("ey") ? { Authorization: `Bearer ${secret}` } : {}) };
  const names = ["delete_expired_admin_history", "delete_expired_diagnostic_events"];
  const responses = await Promise.all(names.map((name) => fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers, body: "{}" })));
  if (responses.some((response) => !response.ok)) return res.status(502).json({ error: "Cleanup failed" });
  return res.status(200).json({ ok: true, retentionDays: 30 });
}
