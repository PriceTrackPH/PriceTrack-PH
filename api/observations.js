import pilotHistory from "../server/db2-pilot-history.js";
import { pilotTarget } from "../server/db2-pilot.js";
import communityCollector from "../server/community-collector.js";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function setCors(res) {
  for (const [name, value] of Object.entries(corsHeaders)) res.setHeader(name, value);
}

export default async function handler(req, res) {
  if (req.method === "GET" && req.query?.db2Pilot === "1") return pilotHistory(req, res);
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (req.body?.communityCollector === true) return communityCollector(req, res);

  const { shopId, productId, platform = "shopee" } = req.body || {};
  const pilot = platform === "shopee" && pilotTarget(process.env, shopId, productId);
  const supabaseUrl = (pilot ? process.env.SUPABASE_DB2_URL || "" : process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const publishableKey = pilot ? process.env.SUPABASE_DB2_PUBLISHABLE_KEY : process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !publishableKey) {
    return res.status(503).json({ error: "Collector is not configured" });
  }

  if (pilot && !publishableKey.startsWith("eyJ")) return res.status(503).json({ error: "Pilot requires its legacy anon JWT" });

  try {
    const recorder = pilot ? "record-price-db2-pilot" : "record-price";
    const response = await fetch(`${supabaseUrl}/functions/v1/${recorder}`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        ...(!pilot || publishableKey.startsWith("eyJ") ? { authorization: `Bearer ${publishableKey}` } : {}),
        "content-type": "application/json",
        "user-agent": String(req.headers?.["user-agent"] || ""),
      },
      body: JSON.stringify(req.body || {}),
    });

    const text = await response.text();
    res.status(response.status);
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/json");
    return res.send(text);
  } catch (error) {
    console.error("Observation collector proxy error", error);
    return res.status(502).json({ error: "Unable to reach the price collector" });
  }
}
