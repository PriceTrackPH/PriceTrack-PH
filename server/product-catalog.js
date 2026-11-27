import { databaseConfig, serviceHeaders, ownersByIds } from "./product-owner.js";

export async function catalogTargets(env, fetcher = fetch) {
  const primary = databaseConfig(env, "db1");
  if (env.PRICETRACK_DATABASE_ROUTING !== "1") return [{ ...primary, ids: null }];
  const response=await fetcher(`${primary.url}/rest/v1/rpc/list_product_database_owners`,{method:'POST',headers:{...serviceHeaders(primary.secret),'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Unable to load product ownership');
  const rows=await response.json();
  if(!Array.isArray(rows))throw Error('Invalid product directory response');
  const owners=[...new Set(rows.map(row=>row.database_id))].filter(owner=>owner!=='db1');
  return [primary,...owners.map(owner=>databaseConfig(env,owner))];
}

export async function ownedCatalogRows(env, target, rows, fetcher=fetch) {
  if(env.PRICETRACK_DATABASE_ROUTING!=='1')return rows;
  const owners=await ownersByIds(env,rows.map(row=>row.id),fetcher);
  return rows.filter(row=>{
    const assigned=owners.get(String(row.id));
    return assigned ? assigned.migration_in_progress===false&&assigned.database_id===target.owner : target.owner==='db1';
  });
}

const projection = "id,name,shop_name,external_shop_id,external_product_id,product_url,price_drop_at,last_seen_at";
export async function searchCatalog(env, { nameFilter, limit = 5, mode = "search", includeInactive=false, recordedOnly=false }, fetcher = fetch) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !["search", "discover", "featured"].includes(mode)) throw Error("Invalid catalog query");
  const targets = await catalogTargets(env, fetcher);
  const collected = [];
  for (const target of targets) {
    const accepted=[];
    const pageSize=Math.max(limit*2,10);
    for(let offset=0;accepted.length<limit;offset+=pageSize){
      const params = new URLSearchParams({ select: projection, platform: "eq.shopee", limit: String(pageSize), offset:String(offset) });
      if (mode === "search") {
        if (typeof nameFilter !== "string" || nameFilter.length > 1000) throw Error("Invalid name filter");
        params.set("name", nameFilter);
        params.set("order", "name.asc,id.asc");
      } else params.set("order", `${mode === "discover" ? "price_drop_at" : "last_seen_at"}.desc.nullslast,id.asc`);
      if (mode !== "featured"&&!includeInactive) params.set("is_active", "eq.true");
      if(recordedOnly)params.set('last_checked_at','not.is.null');
      if (mode === "discover") params.set("price_drop_at", "not.is.null");
      const response = await fetcher(`${target.url}/rest/v1/products?${params}`, {
        headers: serviceHeaders(target.secret), signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw Error("Unable to search assigned product database");
      const rows = await response.json();
      if (!Array.isArray(rows)) throw Error("Invalid catalog response");
      accepted.push(...await ownedCatalogRows(env,target,rows,fetcher));
      if(rows.length<pageSize)break;
    }
    collected.push(...accepted.slice(0,limit));
  }
  const field = mode === "discover" ? "price_drop_at" : "last_seen_at";
  collected.sort((a, b) => mode === "search"
    ? String(a.name).localeCompare(String(b.name), "en") || Number(a.id) - Number(b.id)
    : (Date.parse(b[field]) || 0) - (Date.parse(a[field]) || 0) || Number(a.id) - Number(b.id));
  const unique = new Map();
  for (const row of collected) {
    const identity = `${row.external_shop_id}:${row.external_product_id}`;
    if (!unique.has(identity)) unique.set(identity, row);
  }
  return [...unique.values()].slice(0, limit);
}
