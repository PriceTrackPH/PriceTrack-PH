import { catalogTargets } from "./product-catalog.js";
import { serviceHeaders } from "./product-owner.js";

// Internal helper for saved-ID collection reads and atomic lease updates. The
// caller supplies the original lease/status predicates; they must not be lost
// when splitting an IN query across owners.
export async function ownedProductRows(env, path, options = {}, fetcher = fetch) {
  if (env.PRICETRACK_DATABASE_ROUTING !== "1" || !path.startsWith("products?")) return null;
  const params = new URLSearchParams(path.slice("products?".length));
  const filter = params.get("id") || "";
  const match = filter.match(/^(?:eq\.([1-9]\d*)|in\.\(([1-9]\d*(?:,[1-9]\d*)*)\))$/);
  if (!match || ![undefined, "GET", "PATCH"].includes(options.method)) throw Error("A saved product filter is required");
  const ids = [...new Set((match[1] || match[2]).split(",").map(Number))];
  if (ids.length > 2000 || ids.some(id => !Number.isSafeInteger(id))) throw Error("Invalid saved product IDs");
  const targets = await catalogTargets(env, fetcher);
  const moved = new Set(targets.flatMap(target => target.ids || []));
  const output = [];
  for (const target of targets) {
    const ownerIds = target.ids && new Set(target.ids);
    const selected = ids.filter(id => ownerIds ? ownerIds.has(id) : !moved.has(id));
    if (!selected.length) continue;
    const scoped = new URLSearchParams(params);
    scoped.set("id", `in.(${selected.join(",")})`);
    const headers = new Headers(options.headers);
    headers.delete("authorization");
    for (const [key, value] of Object.entries(serviceHeaders(target.secret))) headers.set(key, value);
    const response = await fetcher(`${target.url}/rest/v1/products?${scoped}`, { signal: AbortSignal.timeout(15000), ...options, headers });
    if (!response.ok) throw Error("Unable to access the assigned collection product");
    if (response.status !== 204) {
      const rows = await response.json();
      if (!Array.isArray(rows)) throw Error("Invalid saved product response");
      output.push(...rows);
    }
  }
  return output;
}
