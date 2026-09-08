(() => {
  const MAX_PRODUCTS = 5_000;
  const MAX_DURATION_MS = 180_000;
  const STABLE_ROUNDS = 5;
  const BATCH_SIZE = 100;

  function productIdentityFromUrl(value) {
    try {
      const url = new URL(String(value), "https://shopee.ph/");
      if (!/(^|\.)shopee\.ph$/i.test(url.hostname)) return null;
      const match = url.pathname.match(/-i\.(\d+)\.(\d+)/i) || url.pathname.match(/^\/product\/(\d+)\/(\d+)(?:\/|$)/i);
      if (!match || match[1] === "0" || match[2] === "0") return null;
      return { shopId: match[1], externalProductId: match[2] };
    } catch {
      return null;
    }
  }

  function dedupeProductLinks(values) {
    const products = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const identity = productIdentityFromUrl(value);
      if (!identity) continue;
      const key = `${identity.shopId}:${identity.externalProductId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      products.push(identity);
      if (products.length >= MAX_PRODUCTS) break;
    }
    return products;
  }

  function shouldStopScan({ stableRounds, elapsedMs, discovered }) {
    return stableRounds >= STABLE_ROUNDS || elapsedMs >= MAX_DURATION_MS || discovered >= MAX_PRODUCTS;
  }

  const api = { productIdentityFromUrl, dedupeProductLinks, shouldStopScan };
  globalThis.PriceTrackStoreScanner = api;

  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage || typeof document === "undefined") return;

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const send = (message) => chrome.runtime.sendMessage(message).catch?.(() => undefined);

  async function scanStore(scanId) {
    const startedAt = Date.now();
    const seen = new Set();
    let stableRounds = 0;
    try {
      while (true) {
        const links = Array.from(document.querySelectorAll("a[href]"), (anchor) => anchor.href);
        const products = dedupeProductLinks(links);
        const added = [];
        for (const product of products) {
          const key = `${product.shopId}:${product.externalProductId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          added.push(product);
          if (seen.size >= MAX_PRODUCTS) break;
        }

        stableRounds = added.length === 0 ? stableRounds + 1 : 0;
        for (let index = 0; index < added.length; index += BATCH_SIZE) {
          await send({ type: "storeScanProgress", scanId, products: added.slice(index, index + BATCH_SIZE), discovered: seen.size });
        }

        const elapsedMs = Date.now() - startedAt;
        if (shouldStopScan({ stableRounds, elapsedMs, discovered: seen.size })) {
          const complete = stableRounds >= STABLE_ROUNDS;
          await send({ type: "storeScanFinished", scanId, status: complete ? "completed" : "incomplete", discovered: seen.size });
          return;
        }
        window.scrollTo({ top: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), behavior: "smooth" });
        await sleep(1_200);
      }
    } catch (error) {
      await send({ type: "storeScanFinished", scanId, status: "incomplete", discovered: seen.size, error: "Store scan stopped before completion" });
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "startStoreScan" || !/^[0-9a-f-]{36}$/i.test(String(message.scanId || ""))) return;
    void scanStore(String(message.scanId));
  });
})();
