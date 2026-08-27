const SITE_ORIGIN = "https://pricetrackph.com";
const PAGE_SIZE = 1000;
const MAX_PRODUCT_URLS = 49998;

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function validId(value) {
  return /^\d+$/.test(String(value ?? ""));
}

function validDate(value) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function adminHeaders(secret) {
  const headers = { apikey: secret, Accept: "application/json" };
  if (secret.startsWith("ey")) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

async function loadProducts() {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !secret) return [];

  const products = [];
  const headers = adminHeaders(secret);

  for (let offset = 0; offset < MAX_PRODUCT_URLS; offset += PAGE_SIZE) {
    const params = new URLSearchParams({
      select: "external_shop_id,external_product_id,updated_at",
      platform: "eq.shopee",
      is_active: "eq.true",
      order: "updated_at.desc",
      limit: String(Math.min(PAGE_SIZE, MAX_PRODUCT_URLS - offset)),
      offset: String(offset),
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/products?${params}`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`products_${response.status}`);

    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("products_invalid_response");
    products.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  return products;
}

function sitemapXml(products) {
  const urls = [
    { loc: `${SITE_ORIGIN}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${SITE_ORIGIN}/privacy/`, changefreq: "monthly", priority: "0.3" },
  ];

  for (const product of products) {
    if (!validId(product.external_shop_id) || !validId(product.external_product_id)) continue;
    urls.push({
      loc: `${SITE_ORIGIN}/product/shopee/${product.external_shop_id}/${product.external_product_id}`,
      lastmod: validDate(product.updated_at),
      changefreq: "daily",
      priority: "0.7",
    });
  }

  const entries = urls.map((entry) => {
    const lastmod = entry.lastmod ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : "";
    return `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>${lastmod}\n    <changefreq>${entry.changefreq}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method not allowed");
  }

  let products = [];
  try {
    products = await loadProducts();
  } catch (error) {
    console.error("Unable to add product URLs to sitemap", error);
  }

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).send(sitemapXml(products));
}
