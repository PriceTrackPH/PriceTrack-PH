import pilotHistory from "../server/db2-pilot-history.js";
import { pilotTarget } from "../server/db2-pilot.js";
import { recordingDestination, validRoutingSubmission } from "../server/product-database.js";
import communityCollector from "../server/community-collector.js";
import crypto from "node:crypto";
import { recordOwnedProduct, recordRoutingFailure } from "../server/owned-recording.js";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-pricetrack-client-id",
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
  const routingDeadline=AbortSignal.timeout(50000);
  const routedFetch=(url,options={})=>fetch(url,{...options,signal:options.signal?AbortSignal.any([routingDeadline,options.signal]):routingDeadline});

  const { shopId, productId, platform = "shopee" } = req.body || {};
  const primarySecret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const hash = value => crypto.createHash("sha256").update(value).digest("hex");
  const internalToken = String(req.headers?.["x-pricetrack-internal-token"] || "");
  const internalAuthorized = Boolean(primarySecret && internalToken === hash(primarySecret));
  const ownedForward = String(req.headers?.["x-pricetrack-owner-token"] || "");
  if (ownedForward && (process.env.PRICETRACK_DATABASE_ROUTING !== "1" || !primarySecret || ownedForward !== hash(primarySecret))) {
    return res.status(503).json({error:"Owned forwarding is unavailable"});
  }
  if (process.env.PRICETRACK_DATABASE_ROUTING === "1" && req.body?.source === "scheduled_collector" && !internalAuthorized) {
    return res.status(403).json({error:"Invalid internal collector authorization"});
  }
  if (process.env.PRICETRACK_DATABASE_ROUTING === "1" && !validRoutingSubmission(req.body, {internal:internalAuthorized,clientId:String(req.headers?.["x-pricetrack-client-id"] || "")})) {
    return res.status(400).json({ error: "Invalid required recording data" });
  }
  let destination;
  try {
    destination = await recordingDestination(process.env, req.body,routedFetch);
  } catch {
    // Do not fall back to DB1 when ownership cannot be resolved.
    return res.status(503).json({ error: "Unable to resolve the product database. Please retry later." });
  }
  // Keep the original three-product pilot independent during this trial.
  if (destination?.owner === "db1" && pilotTarget(process.env, shopId, productId)) destination = null;
  if (destination && destination.owner !== "db1") {
    try {
      const result = await recordOwnedProduct(process.env, req.body, req.headers || {}, routedFetch, internalAuthorized);
      return res.status(result.status).json(result.body);
    } catch {
      await recordRoutingFailure(process.env,req.body,destination.owner,503,routedFetch);
      return res.status(503).json({error:"Unable to confirm recording in the assigned database. Please retry later."});
    }
  }
  if (ownedForward) return res.status(503).json({error:"Owned forwarding destination changed"});
  const forwardedPilotToken = String(req.headers?.["x-pricetrack-pilot-token"] || "");
  const enabledPilot = !destination && req.body?.pageOutcome == null && platform === "shopee" && pilotTarget(process.env, shopId, productId);
  if (forwardedPilotToken && (!enabledPilot || !primarySecret || forwardedPilotToken !== hash(primarySecret))) {
    return res.status(503).json({ error: "Pilot forwarding is unavailable" });
  }
  // On production every regular recording enters DB1's authenticated recorder
  // first. It forwards only these identities and owns queue/status completion.
  const pilot = enabledPilot && (process.env.VERCEL_ENV !== "production" || Boolean(forwardedPilotToken));
  const supabaseUrl = destination?.url || (pilot ? process.env.SUPABASE_DB2_URL || "" : process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const publishableKey = destination?.publishableKey || (pilot ? process.env.SUPABASE_DB2_PUBLISHABLE_KEY : process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "");

  if (!supabaseUrl || !publishableKey) {
    return res.status(503).json({ error: "Collector is not configured" });
  }

  if (pilot && !publishableKey.startsWith("eyJ")) return res.status(503).json({ error: "Pilot requires its legacy anon JWT" });

  try {
    const internalToken = String(req.headers?.["x-pricetrack-internal-token"] || "");
    let recorderToken = internalToken;
    if (pilot && req.body?.source === "scheduled_collector") {
      const db2Secret = process.env.SUPABASE_DB2_SECRET_KEY || "";
      if (!primarySecret || !db2Secret || internalToken !== hash(primarySecret)) {
        return res.status(403).json({ error: "Invalid internal collector authorization" });
      }
      recorderToken = hash(db2Secret);
    }
    const recorder = destination?.recorder || (pilot ? "record-price-db2-pilot" : "record-price");
    const response = await fetch(`${supabaseUrl}/functions/v1/${recorder}`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        ...(!pilot || publishableKey.startsWith("eyJ") ? { authorization: `Bearer ${publishableKey}` } : {}),
        "content-type": "application/json",
        "user-agent": String(req.headers?.["user-agent"] || ""),
        ...(req.headers?.["x-pricetrack-client-id"] ? { "x-pricetrack-client-id": String(req.headers["x-pricetrack-client-id"]) } : {}),
        ...(recorderToken ? { "x-pricetrack-internal-token": recorderToken } : {}),
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
