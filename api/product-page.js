const SITE_ORIGIN = "https://pricetrackph.com";

function validId(value) {
  return /^\d+$/.test(String(value ?? ""));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function adminHeaders(secret) {
  const headers = { apikey: secret, Accept: "application/json" };
  if (secret.startsWith("ey")) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

async function fetchProduct(shopId, productId) {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !secret) throw new Error("product_page_not_configured");

  const params = new URLSearchParams({
    select: "external_shop_id,external_product_id,name,shop_name,image_url",
    platform: "eq.shopee",
    external_shop_id: `eq.${shopId}`,
    external_product_id: `eq.${productId}`,
    limit: "1",
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/products?${params}`, {
    headers: adminHeaders(secret),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`product_${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function fetchApplicationShell() {
  const response = await fetch(`${SITE_ORIGIN}/`, {
    headers: { Accept: "text/html", "User-Agent": "PriceTrackPH-ProductPage/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`shell_${response.status}`);
  return response.text();
}

function replaceMeta(html, selectorPattern, replacement) {
  return html.replace(selectorPattern, replacement);
}

function renderProductPage(shell, product, canonicalUrl) {
  const title = `${product.name} Price History | PriceTrack PH`;
  const description = `View recorded Shopee Philippines price history, product variations and price changes for ${product.name} on PriceTrack PH.`;
  const imageUrl = safeHttpsUrl(product.image_url);
  const htmlTitle = escapeHtml(title);
  const htmlDescription = escapeHtml(description);
  const htmlCanonical = escapeHtml(canonicalUrl);
  const htmlImage = imageUrl ? escapeHtml(imageUrl) : null;

  let html = shell;
  html = replaceMeta(html, /<title>[\s\S]*?<\/title>/i, `<title>${htmlTitle}</title>`);
  html = replaceMeta(html, /<meta name="description" content="[^"]*"\s*\/>/i, `<meta name="description" content="${htmlDescription}" />`);
  html = replaceMeta(html, /<link rel="canonical" href="[^"]*"\s*\/>/i, `<link rel="canonical" href="${htmlCanonical}" />`);
  html = replaceMeta(html, /<meta property="og:title" content="[^"]*"\s*\/>/i, `<meta property="og:title" content="${htmlTitle}" />`);
  html = replaceMeta(html, /<meta property="og:description" content="[^"]*"\s*\/>/i, `<meta property="og:description" content="${htmlDescription}" />`);
  html = replaceMeta(html, /<meta property="og:url" content="[^"]*"\s*\/>/i, `<meta property="og:url" content="${htmlCanonical}" />`);
  html = replaceMeta(html, /<meta name="twitter:title" content="[^"]*"\s*\/>/i, `<meta name="twitter:title" content="${htmlTitle}" />`);
  html = replaceMeta(html, /<meta name="twitter:description" content="[^"]*"\s*\/>/i, `<meta name="twitter:description" content="${htmlDescription}" />`);
  if (htmlImage) {
    html = replaceMeta(html, /<meta name="twitter:card" content="[^"]*"\s*\/>/i, '<meta name="twitter:card" content="summary_large_image" />');
  }

  const extraMeta = [
    htmlImage ? `<meta property="og:image" content="${htmlImage}" />` : "",
    htmlImage ? `<meta name="twitter:image" content="${htmlImage}" />` : "",
  ].filter(Boolean).join("\n    ");
  if (extraMeta) html = html.replace("</head>", `    ${extraMeta}\n  </head>`);

  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${canonicalUrl}#webpage`,
    url: canonicalUrl,
    name: title,
    description,
    inLanguage: "en-PH",
    isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
    mainEntity: {
      "@type": "Product",
      name: product.name,
      url: canonicalUrl,
      ...(imageUrl ? { image: imageUrl } : {}),
      additionalProperty: [
        { "@type": "PropertyValue", name: "Marketplace", value: "Shopee Philippines" },
        { "@type": "PropertyValue", name: "Shop", value: product.shop_name || "Shopee Philippines seller" },
      ],
    },
  }).replaceAll("<", "\\u003c");
  html = html.replace("</head>", `    <script id="product-server-structured-data" type="application/ld+json">${structuredData}</script>\n  </head>`);
  return html;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method not allowed");
  }

  const shopId = typeof req.query?.shopId === "string" ? req.query.shopId : "";
  const productId = typeof req.query?.productId === "string" ? req.query.productId : "";
  if (!validId(shopId) || !validId(productId)) return res.status(400).send("Invalid product URL");

  try {
    const [product, shell] = await Promise.all([fetchProduct(shopId, productId), fetchApplicationShell()]);
    if (!product) {
      const notFound = shell.replace("</head>", '    <meta name="robots" content="noindex" />\n  </head>');
      return res.status(404).setHeader("Content-Type", "text/html; charset=utf-8").send(notFound);
    }

    const canonicalUrl = `${SITE_ORIGIN}/product/shopee/${shopId}/${productId}`;
    const html = renderProductPage(shell, product, canonicalUrl);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(html);
  } catch (error) {
    console.error("Unable to render product page metadata", error);
    return res.status(502).send("Unable to load this product report right now");
  }
}
