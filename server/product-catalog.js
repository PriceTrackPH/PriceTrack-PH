import { databaseConfig, serviceHeaders } from "./product-owner.js";

export async function catalogTargets(env, fetcher = fetch) {
  const primary = databaseConfig(env, "db1");
  if (env.PRICETRACK_DATABASE_ROUTING !== "1") return [{ ...primary, ids: null }];
  const groups = new Map();
  for (let offset = 0; ; offset += 500) {
    const params = new URLSearchParams({ select: "database_id,internal_product_id,migration_in_progress", database_id: "neq.db1", order: "internal_product_id.asc", limit: "500", offset: String(offset) });
    const response = await fetcher(`${primary.url}/rest/v1/product_database_directory?${params}`, {
      headers: serviceHeaders(primary.secret), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error("Unable to load product ownership");
    const rows = await response.json();
    if (!Array.isArray(rows)) throw Error("Invalid product directory response");
    for (const row of rows) {
      if (row.migration_in_progress !== false) throw Error("Product migration in progress");
      if (!Number.isSafeInteger(Number(row.internal_product_id)) || Number(row.internal_product_id) <= 0) throw Error("Missing saved product ID");
      if (!groups.has(row.database_id)) groups.set(row.database_id, []);
      groups.get(row.database_id).push(Number(row.internal_product_id));
    }
    if (rows.length < 500) break;
  }
  return [{ ...primary, ids: null }, ...[...groups].map(([owner, ids]) => ({ ...databaseConfig(env, owner), ids }))];
}

const projection = "id,name,shop_name,external_shop_id,external_product_id,product_url,price_drop_at,last_seen_at";
export async function searchCatalog(env, { nameFilter, limit = 5, mode = "search" }, fetcher = fetch) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !["search", "discover", "featured"].includes(mode)) throw Error("Invalid catalog query");
  const targets = await catalogTargets(env, fetcher);
  const moved = new Set(targets.flatMap(target => target.ids || []).map(String));
  const collected = [];
  for (const target of targets) {
    const chunks = target.ids ? Array.from({ length: Math.ceil(target.ids.length / 200) }, (_, i) => target.ids.slice(i * 200, i * 200 + 200)) : [null];
    for (const ids of chunks) {
      const params = new URLSearchParams({ select: projection, platform: "eq.shopee", limit: String(limit) });
      if (mode === "search") {
        if (typeof nameFilter !== "string" || nameFilter.length > 1000) throw Error("Invalid name filter");
        params.set("name", nameFilter);
        params.set("order", "name.asc,id.asc");
      } else params.set("order", `${mode === "discover" ? "price_drop_at" : "last_seen_at"}.desc.nullslast,id.asc`);
      if (mode !== "featured") params.set("is_active", "eq.true");
      if (mode === "discover") params.set("price_drop_at", "not.is.null");
      if (ids) params.set("id", `in.(${ids.join(",")})`);
      // Exclude moved identities before LIMIT. Filtering only after the query
      // could hide valid DB1 matches behind the removed copies during cutover.
      if (!ids && moved.size) params.set("id", `not.in.(${[...moved].join(",")})`);
      const response = await fetcher(`${target.url}/rest/v1/products?${params}`, {
        headers: serviceHeaders(target.secret), signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw Error("Unable to search assigned product database");
      const rows = await response.json();
      if (!Array.isArray(rows)) throw Error("Invalid catalog response");
      collected.push(...rows.filter(row => target.owner !== "db1" || !moved.has(String(row.id))));
    }
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
