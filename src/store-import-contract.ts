export const STORE_SCAN_PAGE_SOURCE = "pricetrack-store-scan-page";
export const STORE_SCAN_EXTENSION_SOURCE = "pricetrack-store-scan-extension";
export const MAX_STORE_SCAN_PRODUCTS = 5_000;

export type ShopeeStoreIdentity = {
  storeKey: string;
  storeUrl: string;
  displayName: string;
};

export type StoreProductIdentity = {
  shopId: string;
  externalProductId: string;
  productUrl: string;
};

const numericId = /^[1-9]\d*$/;

export function normalizeShopeeStoreUrl(value: string): ShopeeStoreIdentity | null {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "shopee.ph" || url.username || url.password) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1 || /-i\.\d+\.\d+$/i.test(segments[0])) return null;
    const displayName = decodeURIComponent(segments[0]).trim();
    if (!displayName || !/^[a-z0-9._-]+$/i.test(displayName)) return null;
    const storeKey = displayName.toLowerCase();
    return { storeKey, storeUrl: `https://shopee.ph/${storeKey}`, displayName };
  } catch {
    return null;
  }
}

export function normalizeDiscoveredProducts(values: unknown, maximum = MAX_STORE_SCAN_PRODUCTS): StoreProductIdentity[] {
  if (!Array.isArray(values)) return [];
  const limit = Math.min(MAX_STORE_SCAN_PRODUCTS, Math.max(0, Math.trunc(Number(maximum) || 0)));
  const products: StoreProductIdentity[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const candidate = value as Record<string, unknown>;
    const shopId = String(candidate.shopId ?? "");
    const externalProductId = String(candidate.externalProductId ?? candidate.productId ?? "");
    if (!numericId.test(shopId) || !numericId.test(externalProductId)) continue;
    const key = `${shopId}:${externalProductId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    products.push({
      shopId,
      externalProductId,
      productUrl: `https://shopee.ph/product/${shopId}/${externalProductId}`,
    });
    if (products.length >= limit) break;
  }
  return products;
}

export function includeStoreImportsDefault(stored: string | null): boolean {
  return stored !== "false";
}
