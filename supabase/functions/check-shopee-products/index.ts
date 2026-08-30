import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const MAX_BATCH_SIZE = 10;

type DueProduct = {
  product_id: number;
  shop_id: string;
  external_product_id: string;
  product_url: string;
};

type NormalizedVariation = {
  variationId: string;
  variationName: string;
  sku: string | null;
  price: number;
  originalPrice: number | null;
  isInStock: boolean;
  metadata: Record<string, unknown>;
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function adminHeaders(secret: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { apikey: secret, ...extra };
  if (secret.startsWith("ey")) headers.authorization = `Bearer ${secret}`;
  return headers;
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function shopeePrice(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount / 100_000;
}

function imageFromShopeeKey(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  if (/^https:\/\//i.test(value)) return value;
  return `https://down-ph.img.susercontent.com/file/${value}`;
}

function variationNameFromTiers(item: Record<string, unknown>, model: Record<string, unknown>) {
  const extinfo = model.extinfo as Record<string, unknown> | undefined;
  const indexes = extinfo?.tier_index;
  const tiers = item.tier_variations ?? item.tierVariations;
  if (!Array.isArray(indexes) || !Array.isArray(tiers)) return "";

  return indexes.map((optionIndex, tierIndex) => {
    const tier = tiers[tierIndex] as Record<string, unknown> | undefined;
    const options = tier?.options ?? tier?.option_list ?? tier?.optionList;
    if (!Array.isArray(options)) return "";
    const option = options[Number(optionIndex)];
    if (typeof option === "string") return option.trim();
    if (!option || typeof option !== "object") return "";
    const record = option as Record<string, unknown>;
    return String(record.option ?? record.name ?? record.value ?? "").trim();
  }).filter(Boolean).join(" / ");
}

function modelInStock(model: Record<string, unknown>) {
  if (typeof model.has_stock === "boolean") return model.has_stock;
  if (model.is_grayout === true) return false;
  const stock = model.stock ?? model.normal_stock;
  if (stock != null && Number.isFinite(Number(stock))) return Number(stock) > 0;
  if (model.status != null && Number(model.status) === 0) return false;
  return true;
}

function normalizeShopeePayload(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  const item = (data?.item ?? payload.item) as Record<string, unknown> | undefined;
  if (!item) return null;

  const models = Array.isArray(item.models) ? item.models as Record<string, unknown>[] : [];
  const variations = models.map((model, index): NormalizedVariation | null => {
    const price = shopeePrice(model.price ?? model.current_price ?? model.price_min);
    if (price == null) return null;
    const originalPrice = shopeePrice(model.price_before_discount ?? model.original_price ?? model.price_before_discount_min);
    const extinfo = model.extinfo as Record<string, unknown> | undefined;
    const name = String(model.name ?? model.name_tr ?? variationNameFromTiers(item, model) ?? "").trim()
      || (models.length === 1 ? "Default" : `Variation ${index + 1}`);
    return {
      variationId: String(model.model_id ?? model.modelid ?? model.id ?? `model-${index}`),
      variationName: name.slice(0, 200),
      sku: model.model_sku == null && model.sku == null ? null : String(model.model_sku ?? model.sku).slice(0, 200),
      price,
      originalPrice,
      isInStock: modelInStock(model),
      metadata: {
        source: "shopee_models",
        tier_index: Array.isArray(extinfo?.tier_index) ? extinfo?.tier_index : undefined,
        promotion_id: model.promotion_id ?? undefined,
      },
    };
  }).filter((item): item is NormalizedVariation => item !== null);

  if (!variations.length) return null;
  const shop = (data?.shop_detailed ?? data?.shop ?? payload.shop_detailed ?? payload.shop ?? {}) as Record<string, unknown>;
  const images = item.images;
  return {
    title: String(item.title ?? item.name ?? "").trim().slice(0, 500),
    imageUrl: imageFromShopeeKey(item.image ?? (Array.isArray(images) ? images[0] : null)),
    storeName: String(shop.name ?? shop.shop_name ?? shop.username ?? "Shopee Store").trim().slice(0, 200),
    variations,
  };
}

async function fetchShopeeProduct(product: DueProduct) {
  const endpoints = [
    `https://shopee.ph/api/v4/pdp/get_pc?shop_id=${encodeURIComponent(product.shop_id)}&item_id=${encodeURIComponent(product.external_product_id)}`,
    `https://shopee.ph/api/v4/pdp/get?shop_id=${encodeURIComponent(product.shop_id)}&item_id=${encodeURIComponent(product.external_product_id)}`,
  ];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const result = await fetch(endpoint, {
        headers: {
          accept: "application/json",
          referer: product.product_url,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
          "x-api-source": "pc",
        },
        signal: controller.signal,
      });
      if (!result.ok) continue;
      const payload = await result.json() as Record<string, unknown>;
      const normalized = normalizeShopeePayload(payload);
      if (normalized?.title && normalized.variations.length) return normalized;
    } catch (error) {
      console.error("Shopee request failed", product.product_id, error);
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

async function markFailure(supabaseUrl: string, secret: string, product: DueProduct, errorCode: string) {
  const checkedAt = new Date();
  const checkedDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(checkedAt);
  await fetch(`${supabaseUrl}/rest/v1/rpc/mark_product_check`, {
    method: "POST",
    headers: adminHeaders(secret, JSON_HEADERS),
    body: JSON.stringify({
      p_product_id: product.product_id,
      p_checked_date: checkedDate,
      p_checked_at: checkedAt.toISOString(),
      p_source: "scheduled_collector",
      p_status: "failure",
      p_variation_count: 0,
      p_changed_count: 0,
      p_unchanged_count: 0,
      p_failed_count: 1,
      p_metadata: { error_code: errorCode },
    }),
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  let secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  try {
    const secretMap = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    secret = secretMap.default || secret;
  } catch {
    // Use the legacy service-role fallback.
  }
  if (!supabaseUrl || !anonKey || !secret) return response({ error: "Collector is not configured" }, 503);

  let requestedBatchSize = 5;
  try {
    const body = await request.json() as { batchSize?: number };
    requestedBatchSize = Number(body.batchSize ?? 5);
  } catch {
    // The default batch size is safe for an empty body.
  }
  const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Number.isFinite(requestedBatchSize) ? requestedBatchSize : 5));

  const claim = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_due_product_checks`, {
    method: "POST",
    headers: adminHeaders(secret, JSON_HEADERS),
    body: JSON.stringify({ p_batch_size: batchSize }),
  });
  if (!claim.ok) return response({ error: "Unable to claim due products" }, 503);
  const products = await claim.json() as DueProduct[];
  const internalToken = await digest(secret);

  const results = await Promise.all(products.map(async (product) => {
    const current = await fetchShopeeProduct(product);
    if (!current) {
      await markFailure(supabaseUrl, secret, product, "shopee_product_unavailable");
      return { productId: product.product_id, ok: false, error: "shopee_product_unavailable" };
    }

    const ingest = await fetch(`${supabaseUrl}/functions/v1/record-price`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        "content-type": "application/json",
        "x-pricetrack-internal-token": internalToken,
      },
      body: JSON.stringify({
        platform: "shopee",
        source: "scheduled_collector",
        shopId: product.shop_id,
        productId: product.external_product_id,
        canonicalUrl: product.product_url,
        title: current.title,
        storeName: current.storeName,
        imageUrl: current.imageUrl,
        observedAt: new Date().toISOString(),
        variations: current.variations,
      }),
    });

    const payload = await ingest.json().catch(() => ({})) as Record<string, unknown>;
    if (!ingest.ok) {
      await markFailure(supabaseUrl, secret, product, "record_price_failed");
      return { productId: product.product_id, ok: false, error: "record_price_failed", status: ingest.status };
    }
    return {
      productId: product.product_id,
      ok: true,
      recordedCount: payload.recordedCount ?? 0,
      unchangedCount: payload.unchangedCount ?? 0,
    };
  }));

  return response({
    ok: results.every((item) => item.ok),
    claimed: products.length,
    succeeded: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  });
});
