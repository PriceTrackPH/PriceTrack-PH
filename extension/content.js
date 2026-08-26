const PRICETRACK_SITE = "https://pricetrackph.com";
const BRIDGE_SOURCE = "pricetrack-ph-page";
const REQUEST_SOURCE = "pricetrack-ph-extension";
let capturedShopeePayload = null;
let recordingPromise = null;
let recordingProductKey = null;
let lastCompletedRun = null;

window.addEventListener("message", event => {
  if (event.source !== window) return;
  const message = event.data;
  if (message?.source !== BRIDGE_SOURCE || message?.type !== "product-data" || !message.payload) return;
  capturedShopeePayload = message.payload;
});

window.postMessage({ source: REQUEST_SOURCE, type: "request-product-data" }, "*");

function parseShopeeIds(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)shopee\.ph$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/-i\.(\d+)\.(\d+)/i) || url.pathname.match(/\/product\/(\d+)\/(\d+)/i);
    return match ? {
      shopId: match[1],
      productId: match[2],
      canonicalUrl: `${url.origin}${url.pathname}`,
    } : null;
  } catch {
    return null;
  }
}

function getInstallationId() {
  return new Promise(resolve => chrome.storage.local.get("clientId", result => {
    const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (validId.test(result.clientId || "")) return resolve(result.clientId);
    const clientId = crypto.randomUUID();
    chrome.storage.local.set({ clientId }, () => resolve(clientId));
  }));
}

function storageSet(key, value) {
  return new Promise(resolve => chrome.storage.local.set({ [key]: value }, resolve));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function money(value) {
  if (!value) return null;
  const match = String(value).match(/[\d][\d,]*(?:\.\d+)?/);
  const normalized = match?.[0]?.replace(/,/g, "") || "";
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function shopeePrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number / 100000;
}

function imageFromShopeeKey(value) {
  if (!value || typeof value !== "string") return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://down-ph.img.susercontent.com/file/${value}`;
}

function findShopeeItemNode(payload, ids) {
  if (!payload || typeof payload !== "object") return null;
  const queue = [payload];
  const seen = new Set();
  let inspected = 0;

  while (queue.length && inspected < 30000) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    inspected += 1;

    const itemId = String(value.item_id ?? value.itemid ?? "");
    const shopId = String(value.shop_id ?? value.shopid ?? "");
    if (itemId === ids.productId && shopId === ids.shopId && Array.isArray(value.models)) {
      return value;
    }

    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child === "object") queue.push(child);
    } else {
      for (const child of Object.values(value)) if (child && typeof child === "object") queue.push(child);
    }
  }

  return null;
}

function extractEmbeddedShopeePayload(ids) {
  for (const script of document.scripts) {
    const text = script.textContent || "";
    if (!text || text.length > 8_000_000 || !/\"models\"|\"model_id\"|\"modelid\"/.test(text)) continue;

    const candidates = [text];
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (findShopeeItemNode(parsed, ids)) return parsed;
      } catch {}
    }
  }
  return null;
}

function variationNameFromTiers(item, model) {
  const indexes = model?.extinfo?.tier_index;
  const tiers = item?.tier_variations || item?.tierVariations;
  if (!Array.isArray(indexes) || !Array.isArray(tiers)) return "";

  const names = indexes.map((optionIndex, tierIndex) => {
    const tier = tiers[tierIndex];
    const options = tier?.options || tier?.option_list || tier?.optionList;
    const option = Array.isArray(options) ? options[Number(optionIndex)] : null;
    if (typeof option === "string") return option.trim();
    return String(option?.option ?? option?.name ?? option?.value ?? "").trim();
  }).filter(Boolean);

  return names.join(" / ");
}

function modelInStock(model) {
  if (typeof model?.has_stock === "boolean") return model.has_stock;
  if (model?.is_grayout === true) return false;
  if (model?.stock != null && Number.isFinite(Number(model.stock))) return Number(model.stock) > 0;
  if (model?.normal_stock != null && Number.isFinite(Number(model.normal_stock))) return Number(model.normal_stock) > 0;
  if (model?.status != null && Number(model.status) === 0) return false;
  return true;
}

function normalizeShopeePayload(payload, ids) {
  const item = findShopeeItemNode(payload, ids);
  if (!item) return null;

  const models = Array.isArray(item.models) ? item.models : [];
  const variations = models.map((model, index) => {
    const price = shopeePrice(model.price ?? model.current_price ?? model.price_min);
    if (!price) return null;

    const originalPrice = shopeePrice(
      model.price_before_discount ?? model.original_price ?? model.price_before_discount_min
    );
    const variationId = String(model.model_id ?? model.modelid ?? model.id ?? `model-${index}`);
    const name = String(
      model.name || model.name_tr || variationNameFromTiers(item, model) || ""
    ).trim() || (models.length === 1 ? "Default" : `Variation ${index + 1}`);

    return {
      variationId,
      variationName: name.slice(0, 200),
      sku: model.model_sku ?? model.sku ?? null,
      price,
      originalPrice,
      isInStock: modelInStock(model),
      metadata: {
        source: "shopee_models",
        tier_index: Array.isArray(model?.extinfo?.tier_index) ? model.extinfo.tier_index : undefined,
        promotion_id: model.promotion_id ?? undefined,
      },
    };
  }).filter(Boolean);

  if (!variations.length) return null;

  const shop = payload?.data?.shop_detailed || payload?.data?.shop || payload?.shop_detailed || payload?.shop || {};
  return {
    title: String(item.title ?? item.name ?? "").trim().slice(0, 500),
    imageUrl: imageFromShopeeKey(item.image || item.images?.[0] || "").slice(0, 2000),
    storeName: String(shop.name ?? shop.shop_name ?? shop.username ?? "Shopee Store").trim().slice(0, 200),
    variations,
    collectionMode: "shopee-models",
  };
}

async function fetchShopeePayload(ids) {
  const endpoints = [
    `/api/v4/pdp/get_pc?shop_id=${encodeURIComponent(ids.shopId)}&item_id=${encodeURIComponent(ids.productId)}`,
    `/api/v4/pdp/get?shop_id=${encodeURIComponent(ids.shopId)}&item_id=${encodeURIComponent(ids.productId)}`,
  ];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    try {
      const response = await fetch(endpoint, {
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-api-source": "pc",
        },
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const payload = await response.json();
      if (findShopeeItemNode(payload, ids)) return payload;
    } catch {}
    finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

function extractPublicProduct() {
  const meta = name => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.content?.trim() || "";
  let jsonProduct = null;
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const value = JSON.parse(node.textContent || "null");
      const items = Array.isArray(value) ? value : [value];
      jsonProduct = items.find(item => item?.["@type"] === "Product") || jsonProduct;
    } catch {}
  }

  const offers = Array.isArray(jsonProduct?.offers) ? jsonProduct.offers[0] : jsonProduct?.offers;
  const findVisibleStoreName = () => {
    const leaves = Array.from(document.querySelectorAll("span, div")).filter(element => element.children.length === 0);
    const activeNode = leaves.find(element => /^Active\s+.+(?:ago|minute|hour|day|week|month|year)/i.test(element.textContent?.trim() || ""));
    if (!activeNode) return "";
    let container = activeNode.parentElement;
    for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
      const pieces = Array.from(container.querySelectorAll("span, div"))
        .filter(element => element.children.length === 0)
        .map(element => element.textContent?.trim() || "")
        .filter(Boolean);
      const activeIndex = pieces.findIndex(value => /^Active\s+/i.test(value));
      const candidate = pieces.slice(0, activeIndex).reverse().find(value =>
        value.length >= 2 && value.length <= 100 &&
        !/^(preferred|mall|shopee mall|chat now|view shop)$/i.test(value) &&
        /[a-z]/i.test(value)
      );
      if (candidate) return candidate;
    }
    return "";
  };

  const image = jsonProduct?.image;
  const jsonImage = Array.isArray(image)
    ? (typeof image[0] === "string" ? image[0] : image[0]?.url)
    : (typeof image === "string" ? image : image?.url);
  const genericSiteName = meta("og:site_name");
  const storeName = offers?.seller?.name || jsonProduct?.seller?.name || findVisibleStoreName() ||
    (!/^shopee$/i.test(genericSiteName) ? genericSiteName : "") || "Shopee Store";

  let price = money(offers?.price || meta("product:price:amount"));
  const selectors = [
    '[itemprop="price"]', 'meta[property="product:price:amount"]',
    '[data-testid*="price" i]', '.pqTWkA', '.IZPeQz',
    '[class*="product-price" i]', '[class*="price" i]'
  ];
  if (!price) {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const value = element.content || element.textContent?.trim();
        if (!value || value.length > 40) continue;
        if (!value.includes("₱") && !/^\s*[\d,.]+\s*$/.test(value)) continue;
        price = money(value);
        if (price) break;
      }
      if (price) break;
    }
  }

  if (!price) {
    const pesoPattern = /^\s*₱\s*[\d,.]+(?:\s*-\s*₱?\s*[\d,.]+)?\s*$/;
    const candidates = [];
    for (const element of document.querySelectorAll("span, div")) {
      const value = element.textContent?.trim() || "";
      if (!pesoPattern.test(value)) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      if (rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.top > innerHeight) continue;
      candidates.push({
        value,
        fontSize: Number.parseFloat(style.fontSize) || 0,
        top: Math.max(0, rect.top),
        area: rect.width * rect.height,
      });
    }
    candidates.sort((a, b) => b.fontSize - a.fontSize || a.area - b.area || a.top - b.top);
    price = money(candidates[0]?.value);
  }

  return {
    title: (jsonProduct?.name || meta("og:title") || document.title).replace(/\s*\|\s*Shopee.*$/i, "").slice(0, 500),
    imageUrl: (jsonImage || meta("og:image") || "").slice(0, 2000),
    storeName: storeName.slice(0, 200),
    price,
    originalPrice: money(meta("product:original_price:amount")),
  };
}

async function collectAllVariations(ids) {
  const capturedNow = normalizeShopeePayload(capturedShopeePayload, ids);
  if (capturedNow?.variations?.length) return capturedNow;

  window.postMessage({ source: REQUEST_SOURCE, type: "request-product-data" }, "*");

  let fetchedPayload = null;
  let fetchFinished = false;
  fetchShopeePayload(ids)
    .then(payload => { fetchedPayload = payload; })
    .catch(() => {})
    .finally(() => { fetchFinished = true; });

  // Fast window for normal page loads.
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const captured = normalizeShopeePayload(capturedShopeePayload, ids);
    if (captured?.variations?.length) return captured;

    if (fetchedPayload) {
      const fetched = normalizeShopeePayload(fetchedPayload, ids);
      if (fetched?.variations?.length) return fetched;
    }

    if (attempt === 4 || attempt === 10) {
      window.postMessage({ source: REQUEST_SOURCE, type: "request-product-data" }, "*");
    }
    await sleep(75);
  }

  let embeddedPayload = extractEmbeddedShopeePayload(ids);
  let embedded = normalizeShopeePayload(embeddedPayload, ids);
  if (embedded?.variations?.length) return embedded;

  // Slow/hard reload window. Shopee can take several seconds to publish PDP model
  // data after a cache-busting reload. Keep the popup in "checking" instead of
  // declaring a false error while the page is still rebuilding.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const captured = normalizeShopeePayload(capturedShopeePayload, ids);
    if (captured?.variations?.length) return captured;

    if (fetchedPayload) {
      const fetched = normalizeShopeePayload(fetchedPayload, ids);
      if (fetched?.variations?.length) return fetched;
    }

    if (attempt % 8 === 0) {
      window.postMessage({ source: REQUEST_SOURCE, type: "request-product-data" }, "*");
    }

    if (attempt === 8 || attempt === 20 || attempt === 32) {
      embeddedPayload = extractEmbeddedShopeePayload(ids);
      embedded = normalizeShopeePayload(embeddedPayload, ids);
      if (embedded?.variations?.length) return embedded;
    }

    // If the first direct request ended before Shopee was ready, retry once midway.
    if (fetchFinished && attempt === 16) {
      fetchFinished = false;
      fetchShopeePayload(ids)
        .then(payload => { fetchedPayload = payload; })
        .catch(() => {})
        .finally(() => { fetchFinished = true; });
    }

    await sleep(150);
  }

  return null;
}

async function waitForVisibleProduct(maxWaitMs = 6000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    const visible = extractPublicProduct();
    if (visible?.price) return visible;
    window.postMessage({ source: REQUEST_SOURCE, type: "request-product-data" }, "*");
    await sleep(250);
  }
  return extractPublicProduct();
}

async function automaticallyRecordPrice() {
  const ids = parseShopeeIds(location.href);
  if (!ids) return;
  const statusKey = `productStatus:${ids.shopId}:${ids.productId}`;
  const legacyStatusKey = `productStatus:${ids.productId}`;

  await storageSet(statusKey, {
    state: "checking",
    variationCount: 0,
    at: new Date().toISOString(),
  });

  let product = await collectAllVariations(ids);
  if (!product) {
    // Only use the visible-price fallback after giving Shopee enough time to
    // expose its real model data. This prevents hard reloads from briefly
    // showing "Price and variation data were not found" for valid products.
    const visible = await waitForVisibleProduct(6000);
    if (!visible?.price) {
      await storageSet(statusKey, {
        state: "error",
        message: "Product data is still unavailable. Reload the Shopee page and PriceTrack will retry.",
        at: new Date().toISOString(),
      });
      return { ok: false, error: "Product data was not available after the reload retry window" };
    }

    product = {
      title: visible.title,
      imageUrl: visible.imageUrl,
      storeName: visible.storeName,
      variations: [{
        variationId: "default",
        variationName: "Default",
        price: visible.price,
        originalPrice: visible.originalPrice,
        isInStock: true,
        metadata: { source: "visible-fallback" },
      }],
      collectionMode: "visible-fallback",
    };
  }

  const visibleProduct = extractPublicProduct();
  product.title = product.title || visibleProduct.title;
  product.imageUrl = product.imageUrl || visibleProduct.imageUrl;
  product.storeName = product.storeName || visibleProduct.storeName;

  const validVariations = product.variations.filter(item => Number.isFinite(Number(item.price)) && Number(item.price) > 0);
  if (!validVariations.length) {
    await storageSet(statusKey, { state: "error", message: "No valid variation prices were found", at: new Date().toISOString() });
    return { ok: false, error: "No valid variation prices were found" };
  }

  const inStockVariations = validVariations.filter(item => item.isInStock !== false);
  const lowestPool = inStockVariations.length ? inStockVariations : validVariations;
  const lowest = lowestPool.reduce(
    (best, current) => !best || current.price < best.price ? current : best,
    null
  );

  const detectedStatus = {
    state: "detected",
    price: Number(lowest?.price ?? 0) || null,
    lowestVariationName: lowest?.variationName || null,
    variationCount: validVariations.length,
    collectionMode: product.collectionMode,
    at: new Date().toISOString(),
  };
  await storageSet(statusKey, detectedStatus);
  await storageSet(legacyStatusKey, detectedStatus);

  try {
    const installationId = await getInstallationId();
    const response = await fetch(`${PRICETRACK_SITE}/api/observations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        platform: "shopee",
        ...ids,
        title: product.title,
        imageUrl: product.imageUrl,
        storeName: product.storeName,
        variations: validVariations,
        installationId,
        observedAt: new Date().toISOString(),
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Recording failed");

    const recordedStatus = {
      state: "recorded",
      price: Number(data.lowestPrice ?? lowest?.price ?? 0) || null,
      lowestVariationName: data.lowestVariationName || lowest?.variationName || null,
      variationCount: Number(data.variationCount ?? validVariations.length) || validVariations.length,
      recordedCount: Number(data.recordedCount ?? 0),
      unchangedCount: Number(data.unchangedCount ?? 0),
      collectionMode: product.collectionMode,
      at: new Date().toISOString(),
    };
    await storageSet(statusKey, recordedStatus);
    await storageSet(legacyStatusKey, recordedStatus);

    return {
      ok: true,
      price: recordedStatus.price,
      variationCount: recordedStatus.variationCount,
      lowestVariationName: recordedStatus.lowestVariationName,
      collectionMode: recordedStatus.collectionMode,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await storageSet(statusKey, {
      ...detectedStatus,
      state: "detected",
      saveError: message,
      message: "Variations detected, but saving the price history did not finish.",
      at: new Date().toISOString(),
    });
    return { ok: false, error: message, detected: true, variationCount: validVariations.length };
  }
}

function runAutomaticRecording() {
  const ids = parseShopeeIds(location.href);
  if (!ids) return Promise.resolve();
  const key = `${ids.shopId}:${ids.productId}`;

  if (recordingPromise && recordingProductKey === key) return recordingPromise;

  if (lastCompletedRun?.key === key && Date.now() - lastCompletedRun.at < 8000) {
    return Promise.resolve(lastCompletedRun.result);
  }

  recordingProductKey = key;
  recordingPromise = automaticallyRecordPrice()
    .then(result => {
      lastCompletedRun = { key, at: Date.now(), result };
      return result;
    })
    .finally(() => {
      recordingPromise = null;
      recordingProductKey = null;
    });

  return recordingPromise;
}

// Start at document_start. Shopee's full DOMContentLoaded event can take 10–20+
// seconds on media-heavy product pages, but model data is available much earlier.
runAutomaticRecording();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "recordPriceNow") return false;
  runAutomaticRecording().then(sendResponse);
  return true;
});
