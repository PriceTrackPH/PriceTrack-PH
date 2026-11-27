// The directory assigns an identity once. Never discover ownership by trying
// writes against each database: an outage must not create a second product.
export function validRoutingSubmission(body, {internal = false, clientId = ""} = {}) {
  if (!body || typeof body.title !== "string" || !body.title.trim() || body.title.length > 500 ||
      (!internal && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId || body.installationId || ""))) return false;
  try {
    const url = new URL(body.canonicalUrl);
    const match = url.pathname.match(/-i\.(\d+)\.(\d+)/i) || url.pathname.match(/\/product\/(\d+)\/(\d+)/i);
    if (url.protocol !== "https:" || !/(^|\.)shopee\.ph$/i.test(url.hostname) || !match || match[1] !== body.shopId || match[2] !== body.productId) return false;
  } catch { return false; }
  if (body.pageOutcome != null) return ["sold_out", "does_not_exist", "unlisted", "page_error"].includes(body.pageOutcome);
  const variations = Array.isArray(body.variations) && body.variations.length ? body.variations : [body];
  return variations.length <= 200 && variations.every(item => item &&
    typeof item.variationId === "string" && item.variationId.trim() &&
    typeof item.variationName === "string" && item.variationName.trim() &&
    typeof item.price === "number" && Number.isFinite(item.price) && item.price > 0);
}

export async function recordingDestination(env, body, fetcher = fetch) {
  if (env.PRICETRACK_DATABASE_ROUTING !== "1") return null;
  const { platform = "shopee", shopId, productId } = body || {};
  if (platform !== "shopee" || typeof shopId !== "string" || typeof productId !== "string" ||
      !/^\d{1,24}$/.test(shopId) || !/^\d{1,24}$/.test(productId)) {
    throw new Error("Invalid product identity");
  }
  const directoryUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!directoryUrl || !key) throw new Error("Product directory is not configured");
  const response = await fetcher(`${directoryUrl}/rest/v1/rpc/assign_product_database`, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { apikey: key, ...(key.startsWith("eyJ") ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" },
    body: JSON.stringify({ p_platform: platform, p_shop_id: shopId, p_product_id: productId }),
  });
  if (!response.ok) throw new Error("Product directory is unavailable");
  const owner = await response.json();
  // Database identifiers are mapped to configured server credentials, never URLs
  // or credentials supplied by a browser or by the directory response.
  if (typeof owner !== "string" || !/^db[1-9]\d{0,2}$/.test(owner)) throw new Error("Invalid product database assignment");
  const number = Number(owner.slice(2));
  const url = (number === 1 ? directoryUrl : env[`SUPABASE_DB${number}_URL`] || "").replace(/\/$/, "");
  const publishableKey = number === 1
    ? env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY
    : env[`SUPABASE_DB${number}_PUBLISHABLE_KEY`];
  if (!url || !publishableKey) throw new Error("Assigned product database is not configured");
  return { owner, url, publishableKey, recorder: owner === "db1" ? "record-price" : "record-price-owned" };
}
