export function pilotTarget(env, shopId, productId) {
  if (env.PRICETRACK_DB2_PILOT !== "1") return false;
  if (env.VERCEL_ENV === "production" && env.PRICETRACK_DB2_PILOT_LIVE !== "1") return false;
  if (typeof shopId !== "string" || typeof productId !== "string") return false;
  if (!/^\d{1,24}$/.test(shopId) || !/^\d{1,24}$/.test(productId)) return false;
  return (env.PRICETRACK_DB2_PRODUCTS || "").split(",").includes(`${shopId}:${productId}`);
}

export async function pilotReadsActive(env, shopId, productId, fetcher = fetch) {
  if (!pilotTarget(env,shopId,productId)) return false;
  if (env.VERCEL_ENV !== "production") return true;
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/,"");
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !secret) throw Error("Pilot control database is not configured");
  const response = await fetcher(`${url}/rest/v1/site_settings?key=eq.db2_pilot_live&select=boolean_value&limit=1`, {
    headers:{apikey:secret,...(secret.startsWith("ey") ? {Authorization:`Bearer ${secret}`} : {})},signal:AbortSignal.timeout(8000),
  });
  if (!response.ok) throw Error("Unable to verify pilot routing");
  return (await response.json())[0]?.boolean_value === true;
}
