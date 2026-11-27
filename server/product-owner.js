// Read-only ownership resolution. Looking at a report must never allocate a new
// product or silently fall back to another database after a failed lookup.
export function databaseConfig(env, owner) {
  if (!/^db[1-9]\d{0,2}$/.test(owner)) throw Error("Invalid product database owner");
  const primary = owner === "db1";
  const prefix = `SUPABASE_DB${owner.slice(2)}`;
  const url = (primary ? env.SUPABASE_URL || env.VITE_SUPABASE_URL || "" : env[`${prefix}_URL`] || "").replace(/\/$/, "");
  const secret = primary ? env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY : env[`${prefix}_SECRET_KEY`];
  const publishableKey = primary ? env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY : env[`${prefix}_PUBLISHABLE_KEY`];
  if (!url || !secret) throw Error("Assigned product database is not configured");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw Error("Invalid configured database URL");
  return { owner, url, secret, publishableKey };
}

export function serviceHeaders(secret) {
  return { apikey: secret, ...(secret.startsWith("ey") ? { Authorization: `Bearer ${secret}` } : {}) };
}

export async function ownersByIds(env, ids, fetcher=fetch) {
  const primary=databaseConfig(env,'db1');
  const owners=new Map();
  if(ids.some(id=>!Number.isSafeInteger(Number(id))||Number(id)<1))throw Error('Invalid saved product IDs');
  for(let offset=0;offset<ids.length;offset+=200){
    const params=new URLSearchParams({select:'database_id,internal_product_id,migration_in_progress',internal_product_id:`in.(${ids.slice(offset,offset+200).join(',')})`});
    const response=await fetcher(`${primary.url}/rest/v1/product_database_directory?${params}`,{headers:serviceHeaders(primary.secret),signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error('Product directory is unavailable');
    const rows=await response.json();
    if(!Array.isArray(rows))throw Error('Invalid product directory response');
    for(const row of rows)owners.set(String(row.internal_product_id),row);
  }
  return owners;
}

export async function productOwner(env, identity, fetcher = fetch) {
  if (env.PRICETRACK_DATABASE_ROUTING !== "1") return null;
  const params = new URLSearchParams({ select: "database_id,migration_in_progress,internal_product_id", limit: "2" });
  if (identity.id != null) {
    if (!/^[1-9]\d{0,15}$/.test(String(identity.id)) || !Number.isSafeInteger(Number(identity.id))) throw Error("Invalid saved product ID");
    params.set("internal_product_id", `eq.${identity.id}`);
  } else {
    if (typeof identity.shopId !== "string" || typeof identity.productId !== "string" ||
        !/^\d{1,24}$/.test(identity.shopId) || !/^\d{1,24}$/.test(identity.productId)) throw Error("Invalid product identity");
    params.set("platform", "eq.shopee");
    params.set("external_shop_id", `eq.${identity.shopId}`);
    params.set("external_product_id", `eq.${identity.productId}`);
  }
  const primary = databaseConfig(env, "db1");
  const response = await fetcher(`${primary.url}/rest/v1/product_database_directory?${params}`, {
    headers: serviceHeaders(primary.secret), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw Error("Product directory is unavailable");
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length > 1) throw Error("Invalid product directory response");
  // Unknown identities are not an instruction to create a product in DB1.
  if (!rows.length) return { missing: true };
  const row = rows[0];
  if (row.migration_in_progress !== false) throw Error("Product migration in progress");
  return { ...databaseConfig(env, row.database_id), id: row.internal_product_id };
}

export async function collectorProductDatabase(env, primaryUrl, primarySecret, identity, fetcher = fetch) {
  const primary = { url: primaryUrl, secret: primarySecret };
  if (env.PRICETRACK_DATABASE_ROUTING !== "1") return primary;
  const target = await productOwner(env, identity, fetcher);
  if (target?.missing) throw Error("Product ownership is missing");
  return target || primary;
}
