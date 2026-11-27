import { databaseConfig, serviceHeaders, ownersByIds } from "./product-owner.js";

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
  const owners=await ownersByIds(env,ids,fetcher);
  const groups=new Map();
  for(const id of ids){
    const assigned=owners.get(String(id));
    if(assigned&&assigned.migration_in_progress!==false)throw Error('Product migration in progress');
    const owner=assigned?.database_id||'db1';
    if(!groups.has(owner))groups.set(owner,[]);
    groups.get(owner).push(id);
  }
  const output = [];
  for (const [owner, selected] of groups) {
    const target=databaseConfig(env,owner);
    if (!selected.length) continue;
    for(let offset=0;offset<selected.length;offset+=200){
    const scoped = new URLSearchParams(params);
    scoped.set("id", `in.(${selected.slice(offset,offset+200).join(",")})`);
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
  }
  return output;
}
