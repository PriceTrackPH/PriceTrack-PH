import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-pricetrack-client-id",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json",
};

type VariationObservation = {
  variationId?: string;
  variationName?: string;
  sku?: string | null;
  price?: number;
  originalPrice?: number | null;
  isInStock?: boolean;
  metadata?: Record<string, unknown>;
};

type Observation = {
  platform?: string;
  shopId?: string;
  productId?: string;
  canonicalUrl?: string;
  title?: string;
  storeName?: string;
  imageUrl?: string;
  observedAt?: string;
  installationId?: string;
  variationId?: string;
  variationName?: string;
  price?: number;
  originalPrice?: number | null;
  variations?: VariationObservation[];
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function adminHeaders(secret: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { apikey: secret, ...extra };
  if (secret.startsWith("ey")) headers.authorization = `Bearer ${secret}`;
  return headers;
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validPrice(value: unknown): value is number {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 && price <= 10_000_000;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const body = await request.json() as Observation;
    const clientId = request.headers.get("x-pricetrack-client-id") || body.installationId || "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) {
      return reply({ error: "Invalid extension installation" }, 400);
    }

    const platform = (body.platform || "shopee").trim().toLowerCase();
    const shopId = body.shopId?.trim() || "";
    const productId = body.productId?.trim() || "";
    const title = body.title?.trim().slice(0, 500) || "";
    const canonicalUrl = body.canonicalUrl?.trim() || "";
    const storeName = body.storeName?.trim().slice(0, 200) || null;
    const imageUrl = body.imageUrl?.trim().slice(0, 2000) || null;
    const observedAt = body.observedAt && !Number.isNaN(Date.parse(body.observedAt))
      ? new Date(body.observedAt)
      : new Date();
    const observedDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(observedAt);

    if (platform !== "shopee" || !/^\d+$/.test(shopId) || !/^\d+$/.test(productId) || !title) {
      return reply({ error: "Invalid public product data" }, 400);
    }

    let productUrl: URL;
    try {
      productUrl = new URL(canonicalUrl);
    } catch {
      return reply({ error: "Invalid product URL" }, 400);
    }
    if (!/(^|\.)shopee\.ph$/i.test(productUrl.hostname)) {
      return reply({ error: "Only Shopee Philippines is supported in this release" }, 400);
    }
    const idMatch = productUrl.pathname.match(/-i\.(\d+)\.(\d+)/i) || productUrl.pathname.match(/\/product\/(\d+)\/(\d+)/i);
    if (!idMatch || idMatch[1] !== shopId || idMatch[2] !== productId) {
      return reply({ error: "Product URL does not match its identifiers" }, 400);
    }

    const submitted: VariationObservation[] = Array.isArray(body.variations) && body.variations.length
      ? body.variations
      : [{
          variationId: body.variationId || "default",
          variationName: body.variationName || "Default",
          price: body.price,
          originalPrice: body.originalPrice,
          isInStock: true,
        }];

    if (submitted.length > 200) return reply({ error: "Too many variations in one product" }, 400);

    const deduped = new Map<string, Required<Pick<VariationObservation, "variationId" | "variationName" | "price" | "isInStock">> & VariationObservation>();
    for (const item of submitted) {
      const variationId = String(item.variationId || "").trim().slice(0, 200);
      const variationName = String(item.variationName || "").trim().slice(0, 200);
      const price = Number(item.price);
      const originalPrice = item.originalPrice == null ? null : Number(item.originalPrice);
      const isInStock = item.isInStock !== false;
      if (!variationId || !variationName || !validPrice(price)) continue;
      if (originalPrice != null && (!Number.isFinite(originalPrice) || originalPrice < 0 || originalPrice > 10_000_000)) continue;
      deduped.set(variationId, {
        ...item,
        variationId,
        variationName,
        price,
        originalPrice,
        isInStock,
        sku: item.sku == null ? null : String(item.sku).trim().slice(0, 200),
      });
    }

    const variations = Array.from(deduped.values());
    if (!variations.length) return reply({ error: "No valid variation prices were submitted" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const secretMap = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const secret = secretMap.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !secret) return reply({ error: "Collector is not configured" }, 503);
    const headers = adminHeaders(secret);

    const clientHash = await digest(clientId);
    const rateQuery = `${supabaseUrl}/rest/v1/ingest_rate_limits?client_hash=eq.${clientHash}&observed_date=eq.${observedDate}&select=request_count`;
    const rateResponse = await fetch(rateQuery, { headers });
    const rateRows = rateResponse.ok ? await rateResponse.json() as Array<{ request_count: number }> : [];
    const nextCount = (rateRows[0]?.request_count || 0) + 1;
    if (nextCount > 200) return reply({ error: "Daily recording limit reached" }, 429);

    await fetch(`${supabaseUrl}/rest/v1/ingest_rate_limits?on_conflict=client_hash,observed_date`, {
      method: "POST",
      headers: adminHeaders(secret, { "content-type": "application/json", prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify({ client_hash: clientHash, observed_date: observedDate, request_count: nextCount, last_request_at: new Date().toISOString() }),
    });

    const productResponse = await fetch(`${supabaseUrl}/rest/v1/products?on_conflict=platform,external_shop_id,external_product_id`, {
      method: "POST",
      headers: adminHeaders(secret, { "content-type": "application/json", prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify({
        platform,
        external_shop_id: shopId,
        external_product_id: productId,
        product_url: canonicalUrl,
        name: title,
        shop_name: storeName,
        image_url: imageUrl,
        currency: "PHP",
        last_seen_at: observedAt.toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          submitted_variation_count: variations.length,
          collector_format: Array.isArray(body.variations) ? "bulk_models_v1" : "legacy_single_v1",
        },
      }),
    });
    if (!productResponse.ok) throw new Error(`Product upsert failed: ${await productResponse.text()}`);
    const [product] = await productResponse.json() as Array<{ id: number }>;

    let insertedCount = 0;
    let unchangedCount = 0;
    let failedCount = 0;
    const results: Array<{ variationId: string; variationName: string; changed: boolean }> = [];

    for (const item of variations) {
      try {
        const variationPayload: Record<string, unknown> = {
          product_id: product.id,
          external_variation_id: item.variationId,
          name: item.variationName,
          is_active: item.isInStock,
          last_seen_at: observedAt.toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (item.sku) variationPayload.sku = item.sku;
        if (item.metadata && typeof item.metadata === "object") variationPayload.metadata = item.metadata;

        const variationResponse = await fetch(`${supabaseUrl}/rest/v1/product_variations?on_conflict=product_id,external_variation_id`, {
          method: "POST",
          headers: adminHeaders(secret, { "content-type": "application/json", prefer: "resolution=merge-duplicates,return=representation" }),
          body: JSON.stringify(variationPayload),
        });
        if (!variationResponse.ok) throw new Error(`Variation upsert failed: ${await variationResponse.text()}`);
        const [variation] = await variationResponse.json() as Array<{ id: number }>;

        const normalizedOriginalPrice = item.originalPrice == null ? null : Number(item.originalPrice);
        const latestQuery = `${supabaseUrl}/rest/v1/price_observations?variation_id=eq.${variation.id}&select=price,original_price,is_in_stock,observed_date&order=observed_at.desc&limit=1`;
        const latestResponse = await fetch(latestQuery, { headers });
        const latestRows = latestResponse.ok
          ? await latestResponse.json() as Array<{ price: number | string; original_price: number | string | null; is_in_stock: boolean; observed_date: string }>
          : [];
        const latest = latestRows[0];
        const unchangedToday = latest && latest.observed_date === observedDate && Number(latest.price) === item.price && latest.is_in_stock === item.isInStock && (latest.original_price == null ? normalizedOriginalPrice == null : Number(latest.original_price) === normalizedOriginalPrice);

        if (unchangedToday) {
          unchangedCount += 1;
          results.push({ variationId: item.variationId, variationName: item.variationName, changed: false });
          continue;
        }

        const discount = normalizedOriginalPrice && normalizedOriginalPrice > item.price
          ? Math.round((1 - item.price / normalizedOriginalPrice) * 10000) / 100
          : null;

        const observationResponse = await fetch(`${supabaseUrl}/rest/v1/price_observations`, {
          method: "POST",
          headers: adminHeaders(secret, { "content-type": "application/json", prefer: "return=minimal" }),
          body: JSON.stringify({
            variation_id: variation.id,
            observed_date: observedDate,
            observed_at: observedAt.toISOString(),
            price: item.price,
            original_price: normalizedOriginalPrice,
            discount_percent: discount,
            is_in_stock: item.isInStock,
            source: "extension",
            metadata: { bulk_collection: Array.isArray(body.variations), variation_name: item.variationName },
          }),
        });
        if (!observationResponse.ok) throw new Error(`Observation insert failed: ${await observationResponse.text()}`);

        insertedCount += 1;
        results.push({ variationId: item.variationId, variationName: item.variationName, changed: true });
      } catch (error) {
        console.error("Variation recording failed", item.variationId, error);
        failedCount += 1;
      }
    }

    const inStock = variations.filter((item) => item.isInStock);
    const lowest = (inStock.length ? inStock : variations).reduce((best, current) => current.price < best.price ? current : best);
    const status = failedCount === variations.length ? 500 : insertedCount > 0 ? 201 : 200;

    return reply({
      ok: failedCount < variations.length,
      changed: insertedCount > 0,
      shopId,
      productId,
      observedDate,
      variationCount: variations.length,
      recordedCount: insertedCount,
      unchangedCount,
      failedCount,
      lowestPrice: lowest.price,
      lowestVariationId: lowest.variationId,
      lowestVariationName: lowest.variationName,
      results,
    }, status);
  } catch (error) {
    console.error(error);
    return reply({ error: "Unable to record this price" }, 500);
  }
});
