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
      existing.totalSold ??= nullableInteger(value.totalSold);
      existing.salesActivity ??= nullableText(value.salesActivity, 100);
      existing.rating ??= nullableRating(value.rating);
      existing.reviewCount ??= nullableInteger(value.reviewCount);
      continue;
    }
    const product = {
      shopId, externalProductId,
      productUrl: `https://shopee.ph/product/${shopId}/${externalProductId}`,
      soldOut: value.soldOut === true,
      totalSold: nullableInteger(value.totalSold),
      salesActivity: nullableText(value.salesActivity, 100),
      rating: nullableRating(value.rating),
      reviewCount: nullableInteger(value.reviewCount),
    };
    byIdentity.set(key, product);
    products.push(product);
    if (products.length >= limit) break;
  }
  return products;
}

function nullableInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nullableRating(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 5 ? value : null;
}

function nullableText(value, maximum) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= maximum ? text : null;
}
