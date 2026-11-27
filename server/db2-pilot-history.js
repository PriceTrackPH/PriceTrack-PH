import { pilotReadsActive } from "./db2-pilot.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { shopId, productId } = req.query || {};
  try {
    if (typeof shopId !== "string" || typeof productId !== "string" ||
        !await pilotReadsActive(process.env, shopId, productId)) return res.status(404).json({ error: "Not in pilot" });
  } catch { return res.status(503).json({error:"Unable to verify pilot routing"}); }

  const base = (process.env.SUPABASE_DB2_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_DB2_SECRET_KEY;
  if (!base || !key) return res.status(503).json({ error: "Pilot database is not configured" });
  const headers = { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) };
  async function read(table, params) {
    const response = await fetch(`${base}/rest/v1/${table}?${new URLSearchParams(params)}`, { headers });
    if (!response.ok) throw new Error("Pilot query failed");
    return response.json();
  }
  try {
    const [product] = await read("products", { platform: "eq.shopee", external_shop_id: `eq.${shopId}`, external_product_id: `eq.${productId}`, limit: "1" });
    if (!product) return res.status(502).json({ error: "Assigned product is missing from DB2" });
    const variations = await read("product_variations", { product_id: `eq.${product.id}`, order: "name" });
    const real = variations.filter(row => String(row.external_variation_id ?? "").trim().toLowerCase() !== "default");
    const selected = real.length ? real : variations;
    const observations = [];
    if (selected.length) {
      for (let offset = 0; ; offset += 500) {
        const batch = await read("price_observations", { variation_id: `in.(${selected.map(row => row.id).join(",")})`, order: "observed_at.asc,id.asc", limit: "500", offset: String(offset) });
        observations.push(...batch);
        if (batch.length < 500) break;
      }
    }
    return res.status(200).json({ product, variations: selected, observations });
  } catch {
    return res.status(502).json({ error: "Unable to read from pilot database" });
  }
}
