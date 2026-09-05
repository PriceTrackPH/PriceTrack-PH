const DEVICE_ID_KEY = "pricetrack-public-request-device-id";
const REQUEST_FAILURE = "Unable to add this product to the collection queue. Please try again.";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function isMobileUserAgent(userAgent: string, mobileHint?: boolean) {
  if (typeof mobileHint === "boolean") return mobileHint;
  return /(Android|iPhone|iPad|iPod|Mobile)/i.test(userAgent);
}

export function isMobileVisitor() {
  const navigatorWithHints = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return isMobileUserAgent(navigator.userAgent, navigatorWithHints.userAgentData?.mobile);
}

export function getPublicRequestDeviceId(
  storage: StorageLike = window.localStorage,
  createId: () => string = () => crypto.randomUUID(),
) {
  const existing = storage.getItem(DEVICE_ID_KEY);
  if (existing && UUID_V4.test(existing)) return existing;
  const created = createId();
  storage.setItem(DEVICE_ID_KEY, created);
  return created;
}

export function canonicalShopeeUrl(shopId: string, productId: string) {
  return `https://shopee.ph/product/${shopId}/${productId}`;
}

export async function requestUntrackedProduct(ids: { shopId: string; productId: string }) {
  let response: Response;
  try {
    response = await fetch("/api/public-collection-request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        ...ids,
        productUrl: canonicalShopeeUrl(ids.shopId, ids.productId),
        deviceId: getPublicRequestDeviceId(),
      }),
    });
  } catch {
    throw new Error(REQUEST_FAILURE);
  }
  const payload = await response.json().catch(() => ({})) as {
    status?: string;
    message?: string;
    error?: string;
  };

  if (response.ok && (payload.status === "queued" || payload.status === "duplicate") && payload.message) {
    return payload.message;
  }
  if (response.status === 429 && payload.status === "limit_reached" && payload.error) {
    throw new Error(payload.error);
  }
  throw new Error(REQUEST_FAILURE);
}
