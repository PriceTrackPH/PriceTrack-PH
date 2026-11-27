import { productOwner, serviceHeaders } from "./product-owner.js";

export async function ownedProductHistory(env, shopId, productId, fetcher = fetch) {
  const target = await productOwner(env, { shopId, productId }, fetcher);
  // Keep the existing DB1 / three-product pilot path when ownership routing is
  // disabled or when the directory still assigns the product to DB1.
  if (!target || target.owner === "db1") return null;
  if (target.missing) return { missing: true };
  async function read(table, params) {
    const response = await fetcher(`${target.url}/rest/v1/${table}?${new URLSearchParams(params)}`, {
      headers: serviceHeaders(target.secret), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error("Assigned product database is unavailable");
    const rows = await response.json();
    if (!Array.isArray(rows)) throw Error("Invalid product database response");
    return rows;
  }
  const [product] = await read("products", { platform: "eq.shopee", external_shop_id: `eq.${shopId}`, external_product_id: `eq.${productId}`, limit: "1" });
  if (!product || String(product.id) !== String(target.id)) throw Error("Assigned product is missing or has changed identity");
  const primaryUrl=(env.SUPABASE_URL||env.VITE_SUPABASE_URL||'').replace(/\/$/,'');
  const primarySecret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY||'';
  const state=await fetcher(`${primaryUrl}/rest/v1/collector_products?${new URLSearchParams({id:`eq.${product.id}`,select:'collector_page_outcome,last_check_attempt_at,last_checked_at,last_check_status,next_check_at,all_variations_sold_out,stock_status_checked_at,total_sold,review_count,favorite_count,rating,activity_observed_at',limit:'1'})}`,{headers:serviceHeaders(primarySecret),signal:AbortSignal.timeout(8000)});
  if(!state.ok)throw Error('Unable to load central collection status');
  const [queueState]=await state.json();
  if(!queueState)throw Error('Central collection status is missing');
  Object.assign(product,queueState);
  const models = await read("product_variations", { product_id: `eq.${product.id}`, order: "name.asc,id.asc" });
  const real = models.filter(row => String(row.external_variation_id ?? "").trim().toLowerCase() !== "default");
  const variations = real.length ? real : models;
  const observations = [];
  if (variations.length) {
    for (let offset = 0; ; offset += 500) {
      const batch = await read("price_observations", { variation_id: `in.(${variations.map(row => row.id).join(",")})`, order: "observed_at.asc,id.asc", limit: "500", offset: String(offset) });
      observations.push(...batch);
      if (batch.length < 500) break;
    }
  }
  return { product, variations, observations };
}
