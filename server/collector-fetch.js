// Claims, reservations and eligibility remain central. This is intentionally
// separate from product/history reads, which use the owning product database.
export function collectorFetch(input, options, env = process.env, fetcher = globalThis.fetch) {
  if (env.PRICETRACK_DATABASE_ROUTING !== "1") return fetcher(input, options);
  const primary = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  let url = String(input);
  if (primary && url.startsWith(`${primary}/rest/v1/`)) {
    url = url.replace(/\/rest\/v1\/(products|product_variations|product_daily_checks)(?=\?|$)/,
      (_, table) => `/rest/v1/collector_${table}`);
  }
  return fetcher(url, options);
}
