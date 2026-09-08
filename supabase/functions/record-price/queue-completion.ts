type QueueIdentity = {
  platform: string;
  shopId: string;
  productId: string;
};

type FetchResponse = { ok: boolean; status: number };
type Fetcher = (url: string, options: { method: string; headers: Record<string, string>; body: string }) => Promise<FetchResponse>;

export async function completeCollectionQueues(
  fetcher: Fetcher,
  supabaseUrl: string,
  headers: Record<string, string>,
  identity: QueueIdentity,
) {
  const body = JSON.stringify({
    p_platform: identity.platform,
    p_external_shop_id: identity.shopId,
    p_external_product_id: identity.productId,
  });
  const queues = [
    { queue: "priority", rpc: "complete_public_collection_request" },
    { queue: "store", rpc: "complete_store_collection_request" },
  ];
  const failures: Array<{ queue: string; status: number }> = [];
  for (const queue of queues) {
    const response = await fetcher(`${supabaseUrl}/rest/v1/rpc/${queue.rpc}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
    });
    if (!response.ok) failures.push({ queue: queue.queue, status: response.status });
  }
  return failures;
}
