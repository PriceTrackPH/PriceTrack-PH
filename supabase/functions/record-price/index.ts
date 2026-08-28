import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-pricetrack-client-id",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json",
};

const MAX_BODY_BYTES = 512_000;
const MAX_VARIATIONS = 200;
const DAILY_REQUEST_LIMIT = 200;
const MAX_METADATA_BYTES = 4_096;
const MAX_OBSERVATION_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 15 * 60 * 1000;

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

type NormalizedVariation = Required<Pick<VariationObservation, "variationId" | "variationName" | "price" | "isInStock">> & VariationObservation;
type VariationRow = { id: number; external_variation_id: string };
type ObservationRow = {
  variation_id: number;
  price: number | string;
  original_price: number | string | null;
  is_in_stock: boolean;
  observed_at: string;
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function adminHeaders(secret: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { apikey: secret, ...extra };
  if (secret.startsWith("ey")) headers.authorization = `Bearer ${secret}`;
  return headers;
}

async function recordDiagnostic(supabaseUrl: string, secret: string, event: Record<string, unknown>) {
  if (!supabaseUrl || !secret) return;
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/diagnostic_events`, {
      method: "POST",
      headers: adminHeaders(secret, { "content-type": "application/json", prefer: "return=minimal" }),
      body: JSON.stringify(event),
    });
    if (!response.ok) console.error("Diagnostic insert failed", response.status);
  } catch (error) {
    console.error("Diagnostic insert failed", error);
  }
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validPrice(value: unknown): value is number {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 && price <= 10_000_000;
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const json = JSON.stringify(value);
    if (new TextEncoder().encode(json).byteLength > MAX_METADATA_BYTES) return {};
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function validImageUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function sameObservation(latest: ObservationRow | undefined, item: NormalizedVariation) {
  if (!latest) return false;
  const originalPrice = item.originalPrice == null ? null : Number(item.originalPrice);
  return Number(latest.price) === item.price &&
    latest.is_in_stock === item.isInStock &&
    (latest.original_price == null ? originalPrice == null : Number(latest.original_price) === originalPrice);
}

function isDuplicateError(status: number, text: string) {
  return status === 409 || /23505|duplicate key|unique constraint/i.test(text);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return reply({ error: "Request body is too large" }, 413);
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return reply({ error: "Request body is too large" }, 413);
    }

    let body: Observation;
    try {
      body = JSON.parse(rawBody) as Observation;
    } catch {
      return reply({ error: "Invalid JSON body" }, 400);
    }

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
    const imageUrl = validImageUrl(body.imageUrl?.trim().slice(0, 2000) || null);

    const now = new Date();
    const observedAt = body.observedAt && !Number.isNaN(Date.parse(body.observedAt)) ? new Date(body.observedAt) : now;
    const observationAge = now.getTime() - observedAt.getTime();
    if (observationAge > MAX_OBSERVATION_AGE_MS || observationAge < -MAX_FUTURE_SKEW_MS) {
      return reply({ error: "Observation timestamp is outside the allowed window" }, 400);
    }

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
    if (productUrl.protocol !== "https:" || !/(^|\.)shopee\.ph$/i.test(productUrl.hostname)) {
      return reply({ error: "Only Shopee Philippines HTTPS URLs are supported in this release" }, 400);
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

    if (submitted.length > MAX_VARIATIONS) return reply({ error: "Too many variations in one product" }, 400);

    const deduped = new Map<string, NormalizedVariation>();
    for (const item of submitted) {
      const variationId = String(item.variationId || "").trim().slice(0, 200);
      const variationName = String(item.variationName || "").trim().slice(0, 200);
      const price = Number(item.price);
      const originalPrice = item.originalPrice == null ? null : Number(item.originalPrice);
      const isInStock = item.isInStock !== false;
      if (!variationId || !variationName || !validPrice(price)) continue;
      if (originalPrice != null && (!Number.isFinite(originalPrice) || originalPrice < 0 || originalPrice > 10_000_000)) continue;
      deduped.set(variationId, {
        variationId,
        variationName,
        price,
        originalPrice,
        isInStock,
        sku: item.sku == null ? null : String(item.sku).trim().slice(0, 200),
        metadata: safeMetadata(item.metadata),
      });
    }

    const variations = Array.from(deduped.values());
    if (!variations.length) return reply({ error: "No valid variation prices were submitted" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const secretMap = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const secret = secretMap.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !secret) return reply({ error: "Collector is not configured" }, 503);
    const headers = adminHeaders(secret);

    let previousVariationCount: number | null = null;
    let existingProductMetadata: Record<string, unknown> = {};
    const existingProductQuery = new URLSearchParams({
      platform: `eq.${platform}`,
      external_shop_id: `eq.${shopId}`,
      external_product_id: `eq.${productId}`,
      select: "metadata",
      limit: "1",
    });
    const existingProductResponse = await fetch(`${supabaseUrl}/rest/v1/products?${existingProductQuery}`, { headers });
    if (existingProductResponse.ok) {
      const [existingProduct] = await existingProductResponse.json() as Array<{ metadata?: Record<string, unknown> }>;
      if (existingProduct?.metadata && typeof existingProduct.metadata === "object" && !Array.isArray(existingProduct.metadata)) {
        existingProductMetadata = existingProduct.metadata;
      }
      const storedCount = Number(existingProduct?.metadata?.submitted_variation_count);
      if (Number.isInteger(storedCount) && storedCount >= 0) previousVariationCount = storedCount;
    }

    const clientHash = await digest(clientId);
    const quotaResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_ingest_quota`, {
      method: "POST",
      headers: adminHeaders(secret, { "content-type": "application/json" }),
      body: JSON.stringify({
        p_client_hash: clientHash,
        p_observed_date: observedDate,
        p_limit: DAILY_REQUEST_LIMIT,
      }),
    });
    if (!quotaResponse.ok) {
      console.error("Quota check failed", await quotaResponse.text());
      return reply({ error: "Unable to verify recording quota" }, 503);
    }
    const quotaCount = await quotaResponse.json() as number | null;
    if (quotaCount == null) return reply({ error: "Daily recording limit reached" }, 429);

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
        updated_at: now.toISOString(),
        metadata: {
          ...existingProductMetadata,
          submitted_variation_count: variations.length,
          collector_format: Array.isArray(body.variations) ? "bulk_models_v1" : "legacy_single_v1",
        },
      }),
    });
    if (!productResponse.ok) throw new Error(`Product upsert failed: ${await productResponse.text()}`);
    const [product] = await productResponse.json() as Array<{ id: number }>;
    if (!product?.id) throw new Error("Product upsert returned no product ID");

    const nowIso = new Date().toISOString();
    const variationPayloads = variations.map((item) => ({
      product_id: product.id,
      external_variation_id: item.variationId,
      name: item.variationName,
      sku: item.sku || null,
      is_active: item.isInStock,
      last_seen_at: observedAt.toISOString(),
      updated_at: nowIso,
      metadata: safeMetadata(item.metadata),
    }));

    const variationResponse = await fetch(`${supabaseUrl}/rest/v1/product_variations?on_conflict=product_id,external_variation_id`, {
      method: "POST",
      headers: adminHeaders(secret, {
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=representation",
      }),
      body: JSON.stringify(variationPayloads),
    });
    if (!variationResponse.ok) throw new Error(`Variation batch upsert failed: ${await variationResponse.text()}`);
    const variationRows = await variationResponse.json() as VariationRow[];
    const variationRowByExternalId = new Map(variationRows.map((row) => [String(row.external_variation_id), row]));

    const variationIds = variationRows.map((row) => row.id);
    const latestByVariationId = new Map<number, ObservationRow>();
    if (variationIds.length) {
      const latestQuery = `${supabaseUrl}/rest/v1/price_observations?variation_id=in.(${variationIds.join(",")})&observed_date=eq.${observedDate}&select=variation_id,price,original_price,is_in_stock,observed_at&order=observed_at.desc`;
      const latestResponse = await fetch(latestQuery, { headers });
      if (!latestResponse.ok) throw new Error(`Observation lookup failed: ${await latestResponse.text()}`);
      const rows = await latestResponse.json() as ObservationRow[];
      for (const row of rows) {
        if (!latestByVariationId.has(Number(row.variation_id))) latestByVariationId.set(Number(row.variation_id), row);
      }
    }

    let insertedCount = 0;
    let unchangedCount = 0;
    let failedCount = 0;
    let duplicateConflictCount = 0;
    const results: Array<{ variationId: string; variationName: string; changed: boolean }> = [];
    const pending: Array<{ item: NormalizedVariation; payload: Record<string, unknown> }> = [];

    for (const item of variations) {
      const row = variationRowByExternalId.get(item.variationId);
      if (!row) {
        failedCount += 1;
        continue;
      }

      const latest = latestByVariationId.get(row.id);
      if (sameObservation(latest, item)) {
        unchangedCount += 1;
        results.push({ variationId: item.variationId, variationName: item.variationName, changed: false });
        continue;
      }

      const normalizedOriginalPrice = item.originalPrice == null ? null : Number(item.originalPrice);
      const discount = normalizedOriginalPrice && normalizedOriginalPrice > item.price
        ? Math.round((1 - item.price / normalizedOriginalPrice) * 10000) / 100
        : null;

      pending.push({
        item,
        payload: {
          variation_id: row.id,
          observed_date: observedDate,
          observed_at: observedAt.toISOString(),
          price: item.price,
          original_price: normalizedOriginalPrice,
          discount_percent: discount,
          is_in_stock: item.isInStock,
          source: "extension",
          metadata: {
            bulk_collection: Array.isArray(body.variations),
            variation_name: item.variationName,
          },
        },
      });
    }

    if (pending.length) {
      const batchInsert = await fetch(`${supabaseUrl}/rest/v1/price_observations`, {
        method: "POST",
        headers: adminHeaders(secret, { "content-type": "application/json", prefer: "return=minimal" }),
        body: JSON.stringify(pending.map((entry) => entry.payload)),
      });

      if (batchInsert.ok) {
        insertedCount += pending.length;
        for (const entry of pending) results.push({ variationId: entry.item.variationId, variationName: entry.item.variationName, changed: true });
      } else {
        for (const entry of pending) {
          const single = await fetch(`${supabaseUrl}/rest/v1/price_observations`, {
            method: "POST",
            headers: adminHeaders(secret, { "content-type": "application/json", prefer: "return=minimal" }),
            body: JSON.stringify(entry.payload),
          });
          if (single.ok) {
            insertedCount += 1;
            results.push({ variationId: entry.item.variationId, variationName: entry.item.variationName, changed: true });
          } else {
            const text = await single.text();
            if (isDuplicateError(single.status, text)) {
              duplicateConflictCount += 1;
              unchangedCount += 1;
              results.push({ variationId: entry.item.variationId, variationName: entry.item.variationName, changed: false });
            } else {
              console.error("Observation insert failed", entry.item.variationId, text);
              failedCount += 1;
            }
          }
        }
      }
    }

    const inStock = variations.filter((item) => item.isInStock);
    const lowest = (inStock.length ? inStock : variations).reduce((best, current) => current.price < best.price ? current : best);
    const status = failedCount === variations.length ? 500 : insertedCount > 0 ? 201 : 200;

    const diagnosticBase = {
      source: "record-price",
      shop_id: shopId,
      product_id: productId,
      variation_count: variations.length,
      recorded_count: insertedCount,
      unchanged_count: unchangedCount,
      failed_count: failedCount,
      status_code: status,
    };
    const diagnosticEvents: Array<Record<string, unknown>> = [{
      ...diagnosticBase,
      event_type: failedCount > 0 ? "record_partial" : "record_success",
    }];
    if (duplicateConflictCount > 0) {
      diagnosticEvents.push({
        ...diagnosticBase,
        event_type: "duplicate_blocked",
        details: { conflict_count: duplicateConflictCount },
      });
    }
    if (previousVariationCount != null && previousVariationCount !== variations.length) {
      diagnosticEvents.push({
        ...diagnosticBase,
        event_type: "variation_count_changed",
        details: { previous_count: previousVariationCount, current_count: variations.length },
      });
    }
    await Promise.all(diagnosticEvents.map((event) => recordDiagnostic(supabaseUrl, secret, event)));

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    let secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    try {
      const secretMap = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
      secret = secretMap.default || secret;
    } catch {
      // Keep the legacy service-role fallback if the secret map is malformed.
    }
    await recordDiagnostic(supabaseUrl, secret, {
      event_type: "record_failure",
      source: "record-price",
      status_code: 500,
      error_code: "collector_exception",
    });
    return reply({ error: "Unable to record this price" }, 500);
  }
});
