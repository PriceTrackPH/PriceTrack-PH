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

  function dedupeProductCandidates(values) {
    const products = new Map();
    for (const value of Array.isArray(values) ? values : []) {
      const identity = productIdentityFromUrl(value?.href || value);
      if (!identity) continue;
      const key = `${identity.shopId}:${identity.externalProductId}`;
      const previous = products.get(key);
      products.set(key, { ...identity, soldOut: value?.soldOut === true || previous?.soldOut === true });
      if (products.size >= MAX_PRODUCTS) break;
    }
    return [...products.values()];
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

  function readPageProgress(root) {
    const elements = Array.from(root?.querySelectorAll?.("span, div") || []);
    for (const element of elements) {
      const match = String(element.textContent || "").trim().match(/^(\d+)\s*\/\s*(\d+)$/);
      if (!match) continue;
      const current = Number(match[1]);
      const total = Number(match[2]);
      if (Number.isInteger(current) && Number.isInteger(total) && current > 0 && total >= current) return { current, total };
    }
    const current = Number(currentPageMarker(root));
    return { current: Number.isInteger(current) && current > 0 ? current : 1, total: 0 };
  }

  function isFinalStorePage(progress, nextControl) {
    return (progress?.total > 0 && progress.current >= progress.total) || !nextControl || isPageControlDisabled(nextControl);
  }

  function findSoldOutSection(root) {
    const labels = Array.from(root?.querySelectorAll?.("h1, h2, h3, h4, div, span") || [])
      .filter((element) => /^sold\s*out$/i.test(String(element.textContent || "").trim()));
    for (const label of labels) {
      let parent = label.parentElement;
      let insideProductLink = false;
      for (let depth = 0; parent && depth < 6; depth += 1, parent = parent.parentElement) {
        if (String(parent.tagName || "").toLowerCase() === "a" && productIdentityFromUrl(parent.href)) {
          insideProductLink = true;
          break;
        }
      }
      if (insideProductLink) continue;
      let element = label.parentElement;
      for (let depth = 0; element && depth < 8; depth += 1, element = element.parentElement) {
        const links = Array.from(element.querySelectorAll?.("a[href]") || []);
        const productCount = links.filter((anchor) => productIdentityFromUrl(anchor.href)).length;
        if (productCount > 0) return element;
      }
    }
    return null;
  }

  function findSoldOutSeeMoreControl(root) {
    const section = findSoldOutSection(root);
    const controls = Array.from(section?.querySelectorAll?.("button, a, [role='button']") || []);
    return controls.find((element) => /^see\s+more$/i.test(String(element.textContent || "").trim()) && !isPageControlDisabled(element)) || null;
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

  function storeProductCandidates(root) {
    const regular = storeProductLinks(root).map((href) => ({ href, soldOut: false }));
    const section = findSoldOutSection(root);
    const soldOut = Array.from(section?.querySelectorAll?.("a[href]") || [])
      .map((anchor) => ({ href: anchor.href, soldOut: true }));
    return [...regular, ...soldOut];
  }

  const api = { productIdentityFromUrl, dedupeProductLinks, dedupeProductCandidates, shouldStopScan, findNextPageControl, isPageControlDisabled, readPageProgress, isFinalStorePage, findSoldOutSection, findSoldOutSeeMoreControl, pageFingerprint, nextPageStableRounds, hasPageTransitioned, beginScan, endScan, currentPageMarker, isConfirmedEmptyStore, storeProductLinks, storeProductCandidates };
  globalThis.PriceTrackStoreScanner = api;

  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage || typeof document === "undefined") return;

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const send = (message) => chrome.runtime.sendMessage(message).catch?.(() => undefined);

  function pageLinks() {
    return storeProductLinks(document);
  }

  async function expandSoldOutSection() {
    while (true) {
      const control = findSoldOutSeeMoreControl(document);
      if (!control) return;
      const before = dedupeProductCandidates(storeProductCandidates(document)).length;
      control.click();
      let grew = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await sleep(500);
        if (dedupeProductCandidates(storeProductCandidates(document)).length > before) { grew = true; break; }
      }
      if (!grew) throw new Error("The Sold Out section did not finish loading.");
    }
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
    const seen = new Map();
    try {
      while (true) {
        const pageStartedAt = Date.now();
        let stableRounds = 0;
        let fingerprint = "";
        while (stableRounds < STABLE_ROUNDS) {
          const links = pageLinks();
          const products = dedupeProductCandidates(storeProductCandidates(document));
          const added = [];
          for (const product of products) {
            const key = `${product.shopId}:${product.externalProductId}`;
            const previous = seen.get(key);
            if (previous && (previous.soldOut || !product.soldOut)) continue;
            seen.set(key, product);
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
            const pages = readPageProgress(document);
            await send({ type: "storeScanProgress", scanId, products: added.slice(index, index + BATCH_SIZE), discovered: seen.size, pagesCurrent: pages.current, pagesTotal: pages.total });
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
        const pages = readPageProgress(document);
        if (isFinalStorePage(pages, nextPage)) {
          await expandSoldOutSection();
          const finalProducts = dedupeProductCandidates(storeProductCandidates(document));
          const added = [];
          for (const product of finalProducts) {
            const key = `${product.shopId}:${product.externalProductId}`;
            const previous = seen.get(key);
            if (previous && (previous.soldOut || !product.soldOut)) continue;
            seen.set(key, product);
            added.push(product);
          }
          for (let index = 0; index < added.length; index += BATCH_SIZE) {
            await send({ type: "storeScanProgress", scanId, products: added.slice(index, index + BATCH_SIZE), discovered: seen.size, pagesCurrent: pages.current, pagesTotal: pages.total });
          }
          await send({ type: "storeScanFinished", scanId, status: "completed", discovered: seen.size, pagesCurrent: pages.current, pagesTotal: pages.total });
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
      const pages = readPageProgress(document);
      await send({ type: "storeScanFinished", scanId, status: "incomplete", discovered: seen.size, pagesCurrent: pages.current, pagesTotal: pages.total, error: "Store scan stopped before completion" });
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "startStoreScan" || !/^[0-9a-f-]{36}$/i.test(String(message.scanId || ""))) return;
    const scanId = String(message.scanId);
    if (!beginScan(scanId)) return;
    void scanStore(scanId).finally(() => endScan(scanId));
  });
})();
