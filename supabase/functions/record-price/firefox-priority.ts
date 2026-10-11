export function shouldQueueFirefoxRecording(userAgent: string, source: string, isAdminCollector: boolean) {
  return source === "extension" && !isAdminCollector && /(?:Firefox|FxiOS)\//i.test(userAgent);
}

export async function enqueueFirefoxRecording(
  fetcher: typeof fetch, supabaseUrl: string, headers: Record<string, string>,
  identity: { shopId: string; productId: string; canonicalUrl: string },
) {
  return fetcher(`${supabaseUrl}/rest/v1/rpc/enqueue_firefox_collection_request`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      p_external_shop_id: identity.shopId,
      p_external_product_id: identity.productId,
      p_product_url: identity.canonicalUrl,
    }),
  });
}
