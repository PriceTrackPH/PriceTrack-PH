export function pilotTarget(env, shopId, productId) {
  if (env.PRICETRACK_DB2_PILOT !== "1") return false;
  if (env.VERCEL_ENV === "production" && env.PRICETRACK_DB2_PILOT_LIVE !== "1") return false;
  if (typeof shopId !== "string" || typeof productId !== "string") return false;
  if (!/^\d{1,24}$/.test(shopId) || !/^\d{1,24}$/.test(productId)) return false;
  return (env.PRICETRACK_DB2_PRODUCTS || "").split(",").includes(`${shopId}:${productId}`);
}
