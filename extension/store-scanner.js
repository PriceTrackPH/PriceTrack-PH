(() => {
  const MAX_PRODUCTS = 5_000;
  const STABLE_ROUNDS = 5;
  const BATCH_SIZE = 100;
  const PAGE_READY_TIMEOUT_MS = 60_000;
  const activeScans = new Set();

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

  function shouldStopScan({ stableRounds, discovered }) {
    return stableRounds >= STABLE_ROUNDS || discovered >= MAX_PRODUCTS;
  }

  function classText(element) {
    const value = element?.className;
    return typeof value === "string" ? value : String(value?.baseVal || "");
  }

  function isPageControlDisabled(element) {
    if (!element) return true;
    return Boolean(
      element.disabled ||
      element.getAttribute?.("aria-disabled") === "true" ||
      /(?:^|\s)(?:shopee-icon-button--disabled|disabled)(?:\s|$)/i.test(classText(element))
    );
  }

  function findNextPageControl(root) {
    const targeted = root?.querySelector?.([
      ".shopee-page-controller__next-btn",
      ".shopee-page-controller .shopee-icon-button--right",
      "[class*='page-controller'] [aria-label*='next' i]",
      "[class*='pagination'] [aria-label*='next' i]",
    ].join(", "));
    if (targeted) return targeted;
    const controls = Array.from(root?.querySelectorAll?.("button, a[href], [role='button']") || []);
    return controls.find((element) => {
      const label = [element.getAttribute?.("aria-label"), element.getAttribute?.("title"), element.textContent]
        .filter(Boolean)
        .join(" ")
        .trim();
      return /(?:^|\s)next(?:\s+page)?(?:\s|$)/i.test(label);
    }) || null;
  }

  function pageFingerprint(values) {
    return dedupeProductLinks(values)
      .map((product) => `${product.shopId}:${product.externalProductId}`)
      .sort()
      .join("|");
  }

  function nextPageStableRounds(previousFingerprint, currentFingerprint, stableRounds) {
    return previousFingerprint === currentFingerprint ? stableRounds + 1 : 0;
  }

  function hasPageTransitioned(previousFingerprint, previousPageMarker, currentFingerprint, currentPageMarker) {
    if (!currentFingerprint || currentFingerprint === previousFingerprint) return false;
    return previousPageMarker ? Boolean(currentPageMarker && currentPageMarker !== previousPageMarker) : true;
  }

  function beginScan(scanId) {
    if (activeScans.has(scanId)) return false;
    activeScans.add(scanId);
    return true;
  }

  function endScan(scanId) {
    activeScans.delete(scanId);
  }

  function currentPageMarker(root) {
    const current = root?.querySelector?.([
      "[aria-current='page']",
      ".shopee-page-controller .shopee-button-solid--primary",
      ".shopee-page-controller .shopee-button-solid",
      "[class*='page-controller'] [class*='primary']",
    ].join(", "));
    return String(current?.getAttribute?.("data-page") || current?.textContent || "").trim();
  }

  function isConfirmedEmptyStore(root) {
    return Boolean(root?.querySelector?.([
      ".shop-search-empty-view",
      ".shopee-search-empty-result-section",
      "[class*='shop-search-empty']",
      "[class*='no-product']",
    ].join(", ")));
  }

  function storeProductLinks(root) {
    const grid = root?.querySelector?.([
      "#product_list",
      ".shop-search-result-view",
      ".shop-page__all-products-section",
      "[data-testid='shop-all-products']",
    ].join(", "));
    if (!grid) return [];
    return Array.from(grid.querySelectorAll?.("a[href]") || [], (anchor) => anchor.href);
  }

  const api = { productIdentityFromUrl, dedupeProductLinks, shouldStopScan, findNextPageControl, isPageControlDisabled, pageFingerprint, nextPageStableRounds, hasPageTransitioned, beginScan, endScan, currentPageMarker, isConfirmedEmptyStore, storeProductLinks };
  globalThis.PriceTrackStoreScanner = api;

  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage || typeof document === "undefined") return;

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const send = (message) => chrome.runtime.sendMessage(message).catch?.(() => undefined);

  function pageLinks() {
    return storeProductLinks(document);
  }

  async function waitForPageChange(previousFingerprint, previousPageMarker) {
    const deadline = Date.now() + 30_000;
    let candidateFingerprint = "";
    let settledRounds = 0;
    while (Date.now() < deadline) {
      const fingerprint = pageFingerprint(pageLinks());
      const marker = currentPageMarker(document);
      const pageChanged = hasPageTransitioned(previousFingerprint, previousPageMarker, fingerprint, marker);
      if (pageChanged && fingerprint) {
        settledRounds = fingerprint === candidateFingerprint ? settledRounds + 1 : 0;
        candidateFingerprint = fingerprint;
        if (settledRounds >= 2) return true;
      } else {
        candidateFingerprint = "";
        settledRounds = 0;
      }
      await sleep(500);
    }
    return false;
  }

  async function scanStore(scanId) {
    const seen = new Set();
    try {
      while (true) {
        const pageStartedAt = Date.now();
        let stableRounds = 0;
        let fingerprint = "";
        while (stableRounds < STABLE_ROUNDS) {
          const links = pageLinks();
          const products = dedupeProductLinks(links);
          const added = [];
          for (const product of products) {
            const key = `${product.shopId}:${product.externalProductId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            added.push(product);
            if (seen.size >= MAX_PRODUCTS) break;
          }

          const currentFingerprint = pageFingerprint(links);
          stableRounds = nextPageStableRounds(fingerprint, currentFingerprint, stableRounds);
          fingerprint = currentFingerprint;
          if (stableRounds >= STABLE_ROUNDS && !fingerprint && !isConfirmedEmptyStore(document)) {
            if (Date.now() - pageStartedAt >= PAGE_READY_TIMEOUT_MS) {
              await send({ type: "storeScanFinished", scanId, status: "incomplete", discovered: seen.size, error: "The Shopee product grid did not load." });
              return;
            }
            stableRounds = 0;
          }
          for (let index = 0; index < added.length; index += BATCH_SIZE) {
            await send({ type: "storeScanProgress", scanId, products: added.slice(index, index + BATCH_SIZE), discovered: seen.size });
          }

          if (seen.size >= MAX_PRODUCTS) {
            await send({ type: "storeScanFinished", scanId, status: "incomplete", discovered: seen.size });
            return;
          }
          if (stableRounds < STABLE_ROUNDS) {
            window.scrollTo({ top: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), behavior: "smooth" });
            await sleep(1_200);
          }
        }

        const nextPage = findNextPageControl(document);
        if (!nextPage || isPageControlDisabled(nextPage)) {
          await send({ type: "storeScanFinished", scanId, status: "completed", discovered: seen.size });
          return;
        }

        const pageMarker = currentPageMarker(document);
        nextPage.click();
        if (!(await waitForPageChange(fingerprint, pageMarker))) {
          await send({ type: "storeScanFinished", scanId, status: "incomplete", discovered: seen.size, error: "The next Shopee store page did not load." });
          return;
        }
        window.scrollTo({ top: 0, behavior: "auto" });
        await sleep(500);
      }
    } catch (error) {
      await send({ type: "storeScanFinished", scanId, status: "incomplete", discovered: seen.size, error: "Store scan stopped before completion" });
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "startStoreScan" || !/^[0-9a-f-]{36}$/i.test(String(message.scanId || ""))) return;
    const scanId = String(message.scanId);
    if (!beginScan(scanId)) return;
    void scanStore(scanId).finally(() => endScan(scanId));
  });
})();
