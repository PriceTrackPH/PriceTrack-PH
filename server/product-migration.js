import { createHash } from "node:crypto";

export const trialProductIds = Object.freeze([142734, 142732, 142731, 142730, 142729, 142728, 142727, 142726, 142724, 142723, 142722, 142721, 142720, 142719, 142718]);
const tables = ["products", "product_variations", "price_observations", "product_daily_checks", "product_daily_extension_visits", "personal_collection_products", "collector_backlog_products"];
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function digest(rows) {
  // Row order and object-key order do not change the data. Every field value,
  // timestamp, saved ID, price, and stock flag remains part of the comparison.
  const encoded = rows.map(row => JSON.stringify(canonical(row))).sort();
  return createHash("sha256").update(JSON.stringify(encoded)).digest("hex");
}

export function migrationSnapshot(data, ids = trialProductIds, now = Date.now()) {
  if (!Array.isArray(ids) || ids.length !== 15 || new Set(ids).size !== 15 || ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw Error("The trial requires exactly 15 distinct saved product IDs");
  const selected = new Set(ids);
  for (const table of tables) if (!Array.isArray(data[table])) throw Error(`Missing migration table: ${table}`);
  if (data.products.length !== ids.length || new Set(data.products.map(row => row.id)).size !== ids.length || data.products.some(row => !selected.has(row.id))) throw Error("Source product selection is incomplete");
  if (data.products.some(row => row.platform !== "shopee" || !/^\d+$/.test(row.external_shop_id) || !/^\d+$/.test(row.external_product_id))) throw Error("Invalid product identity");
  if (new Set(data.products.map(row => `${row.external_shop_id}:${row.external_product_id}`)).size !== ids.length) throw Error("Duplicate product identity");
  if (data.products.some(row => Date.parse(row.check_lease_until || "") > now)) throw Error("A selected product is currently being collected");
  for (const table of ["product_variations", "product_daily_checks", "product_daily_extension_visits", "personal_collection_products", "collector_backlog_products"]) {
    if (data[table].some(row => !selected.has(row.product_id))) throw Error(`Unrelated product in ${table}`);
  }
  const variations = new Set(data.product_variations.map(row => row.id));
  if (variations.size !== data.product_variations.length || data.price_observations.some(row => !variations.has(row.variation_id))) throw Error("Invalid variation/history relationships");
  if (new Set(data.price_observations.map(row => row.id)).size !== data.price_observations.length) throw Error("Duplicate observation ID");
  return Object.fromEntries(tables.map(table => [table, { count: data[table].length, sha256: digest(data[table]) }]));
}

export function verifyMigrationCopy(source, destination, ids = trialProductIds, now = Date.now()) {
  const before = migrationSnapshot(source, ids, now);
  const after = migrationSnapshot(destination, ids, now);
  for (const table of tables) {
    if (before[table].sha256 !== after[table].sha256) throw Error(`Migration verification failed: ${table}`);
  }
  return before;
}

// Passing a data-copy comparison alone is not permission to remove originals.
// These checks are intentionally separate from the copy operation.
export function requireCutoverEvidence(evidence) {
  for (const check of ["sourceWritesFrozen", "sourceSnapshotVerified", "destinationCopyVerified", "extensionRoutingVerified", "adminClaimsVerified", "communityClaimsVerified", "scheduledCollectorVerified", "searchVerified", "watchlistVerified", "historyVerified", "queueOutcomesVerified", "backupVerified"]) {
    if (evidence?.[check] !== true) throw Error(`Product cutover blocked: ${check}`);
  }
}
