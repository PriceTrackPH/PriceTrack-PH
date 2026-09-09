const MAX_STORE_PRODUCTS = 5000;

export function normalizeShopeeStoreUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "shopee.ph" || url.username || url.password) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1 || /^(?:product|item)$/i.test(segments[0]) || /-i\.\d+\.\d+$/i.test(segments[0])) return null;
    const displayName = decodeURIComponent(segments[0]);
    const storeKey = displayName.toLowerCase();
    return {
      storeKey,
      storeUrl: `https://shopee.ph/${encodeURIComponent(storeKey)}`,
      displayName,
    };
  } catch {
    return null;
  }
}

export function normalizeDiscoveredProducts(values, maximum = MAX_STORE_PRODUCTS) {
  if (!Array.isArray(values)) return [];
  const limit = Math.min(MAX_STORE_PRODUCTS, Math.max(0, Number.isFinite(maximum) ? Math.floor(maximum) : MAX_STORE_PRODUCTS));
  const products = [];
  const byIdentity = new Map();
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const shopId = String(value.shopId ?? "");
    const externalProductId = String(value.externalProductId ?? value.productId ?? "");
    if (!/^[1-9]\d*$/.test(shopId) || !/^[1-9]\d*$/.test(externalProductId)) continue;
    const key = `${shopId}:${externalProductId}`;
    const existing = byIdentity.get(key);
    if (existing) {
      existing.soldOut ||= value.soldOut === true;
      continue;
    }
    const product = { shopId, externalProductId, productUrl: `https://shopee.ph/product/${shopId}/${externalProductId}`, soldOut: value.soldOut === true };
    byIdentity.set(key, product);
    products.push(product);
    if (products.length >= limit) break;
  }
  return products;
}
