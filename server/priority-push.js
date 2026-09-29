import crypto from "node:crypto";
import { sendWebPush, validPushEndpoint, vapidKeys } from "./web-push.js";

const secureEqual = (a, b) => Boolean(a && b) && Buffer.byteLength(a) === Buffer.byteLength(b)
  && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const supabaseUrl = () => (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const dbKey = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
function headers(extra = {}) {
  const key = dbKey();
  return { apikey: key, ...(key.startsWith("ey") ? { Authorization: `Bearer ${key}` } : {}), ...extra };
}
async function rows(path) {
  const result = await fetch(`${supabaseUrl()}/rest/v1/${path}`, { headers: headers() });
  if (!result.ok) throw new Error(`database_read_${result.status}`);
  return result.json();
}
async function update(endpoint, body, method = "PATCH") {
  const result = await fetch(`${supabaseUrl()}/rest/v1/priority_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method, headers: headers({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!result.ok) throw new Error(`database_write_${result.status}`);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!supabaseUrl() || !dbKey() || !process.env.ADMIN_HEALTH_TOKEN) return res.status(503).json({ error: "Push service unavailable" });
  if (req.method === "GET") {
    if (!process.env.CRON_SECRET || !secureEqual(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`))
      return res.status(401).json({ error: "Unauthorized" });
    try {
      const subscriptions = await rows("priority_push_subscriptions?select=endpoint,p256dh,auth,last_notified_at&limit=100");
      const due = await rows(`public_collection_requests?select=request_id,eligible_at&status=in.(pending,completed)&eligible_at=lte.${encodeURIComponent(new Date().toISOString())}&order=eligible_at.asc&limit=1000`);
      let sent = 0;
      for (const sub of subscriptions) {
        const newlyDue = due.filter((r) => Date.parse(r.eligible_at) > Date.parse(sub.last_notified_at));
        if (!newlyDue.length) continue;
        try {
          const result = await sendWebPush(sub, { title: "Priority Queue ready",
            body: `${newlyDue.length} product${newlyDue.length === 1 ? " is" : "s are"} available to check.`, url: "/admin/collector" },
          process.env.ADMIN_HEALTH_TOKEN);
          if (result.status === 404 || result.status === 410) { await update(sub.endpoint, null, "DELETE"); continue; }
          if (!result.ok) continue;
          await update(sub.endpoint, { last_notified_at: newlyDue.at(-1).eligible_at });
          sent++;
        } catch { /* Retry this subscription on the next scheduled run. */ }
      }
      return res.status(200).json({ ok: true, sent });
    } catch { return res.status(500).json({ error: "Push check failed" }); }
  }
  if (req.method !== "POST" || !secureEqual(req.headers.authorization, `Bearer ${process.env.ADMIN_HEALTH_TOKEN}`))
    return res.status(401).json({ error: "Unauthorized" });
  if (req.query.action === "key") {
    if (!process.env.CRON_SECRET) return res.status(503).json({ error: "Background notifications are not configured yet" });
    return res.status(200).json({ publicKey: vapidKeys(process.env.ADMIN_HEALTH_TOKEN).publicKey.toString("base64url") });
  }
  const sub = req.body?.subscription;
  if (req.query.action === "unsubscribe") {
    if (!validPushEndpoint(req.body?.endpoint)) return res.status(400).json({ error: "Invalid subscription" });
    try { await update(req.body.endpoint, null, "DELETE"); return res.status(200).json({ ok: true }); }
    catch { return res.status(500).json({ error: "Unable to remove subscription" }); }
  }
  if (req.query.action !== "subscribe" || !sub || !validPushEndpoint(sub.endpoint)
    || !/^[A-Za-z0-9_-]{80,100}$/.test(String(sub.keys?.p256dh || ""))
    || !/^[A-Za-z0-9_-]{20,30}$/.test(String(sub.keys?.auth || "")))
    return res.status(400).json({ error: "Invalid subscription" });
  try {
    const result = await fetch(`${supabaseUrl()}/rest/v1/priority_push_subscriptions?on_conflict=endpoint`, {
      method: "POST", headers: headers({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }),
    });
    if (!result.ok) throw new Error("Subscription failed");
    return res.status(200).json({ ok: true });
  } catch { return res.status(500).json({ error: "Unable to save subscription" }); }
}
