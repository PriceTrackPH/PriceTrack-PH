const MAX_DISCOVERED_PRODUCTS = 5000;

export function normalizeShopeeStoreUrl(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "shopee.ph") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    const slug = segments[0]?.replace(/^@/, "") || "";
    if (!/^[a-z0-9._-]{2,128}$/i.test(slug) || slug.toLowerCase() === "product") return null;
    return {
      storeKey: slug.toLowerCase(),
      storeUrl: `https://shopee.ph/${slug.toLowerCase()}`,
      displayName: slug,
    };
  } catch {
    return null;
  }
}

export function normalizeDiscoveredProducts(value) {
  if (!Array.isArray(value)) return [];
  const products = [];
  const seen = new Set();
  for (const item of value) {
    const shopId = String(item?.shopId || "");
    const productId = String(item?.productId || "");
    if (!/^\d+$/.test(shopId) || !/^\d+$/.test(productId)) continue;
    const key = `${shopId}:${productId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    products.push({ shopId, productId, productUrl: `https://shopee.ph/product/${shopId}/${productId}` });
    if (products.length >= MAX_DISCOVERED_PRODUCTS) break;
  }
  return products;
}
