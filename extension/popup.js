const SITE = "https://pricetrackph.vercel.app";
const button = document.querySelector("#open");
const title = document.querySelector("#title");
const detail = document.querySelector("#detail");
const status = document.querySelector("#status");
const popupToggle = document.querySelector("#popup-toggle");
const POPUP_SETTING_KEY = "notificationsEnabled";
const STALE_PROGRESS_MS = 20_000;
const STATUS_POLL_MS = 500;
let ids;
let activeTabId;
let primaryKey;
let legacyKey;
let retryRequested = false;
let statusPollTimer = null;

function parseIds(value) {
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

function formatPeso(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? `₱${number.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`
    : "";
}

function recordAgeMs(record) {
  const time = Date.parse(record?.at || "");
  return Number.isFinite(time) ? Math.max(0, Date.now() - time) : Infinity;
}

function stopStatusPolling() {
  if (statusPollTimer != null) {
    clearTimeout(statusPollTimer);
    statusPollTimer = null;
  }
}

function scheduleStatusPolling() {
  stopStatusPolling();
  statusPollTimer = setTimeout(async () => {
    const record = await readStoredStatus();
    if (record && ["checking", "detected"].includes(record.state)) {
      scheduleStatusPolling();
    }
  }, STATUS_POLL_MS);
}

function requestRecording() {
  if (retryRequested || activeTabId == null) return;
  retryRequested = true;

  chrome.tabs.sendMessage(activeTabId, { type: "recordPriceNow" }, async () => {
    const hadError = Boolean(chrome.runtime.lastError);

    if (!hadError) {
      // The content script replies only after the recording promise settles.
      // Re-read storage here so the popup always renders the final state even if
      // chrome.storage.onChanged was missed while the popup was opening/closing.
      await readStoredStatus();
    }

    retryRequested = false;
  });
}

function renderRecord(record) {
  status.classList.remove("error");

  if (record?.state === "recorded") {
    stopStatusPolling();

    const count = Number(record.variationCount || 0);
    const recordedCount = Number(record.recordedCount || 0);
    const unchangedCount = Number(record.unchangedCount || 0);
    const processedCount = recordedCount + unchangedCount;
    const lowest = formatPeso(record.price);
    const lowestName = record.lowestVariationName ? ` · ${record.lowestVariationName}` : "";

    detail.textContent = count > 0
      ? `Item ${ids.productId} · ${count} variation${count === 1 ? "" : "s"}`
      : `Item ${ids.productId}`;

    if (recordedCount === 0 && count > 0 && unchangedCount >= count) {
      status.textContent = `✓ No price changes. All ${count} variation${count === 1 ? "" : "s"} are already up to date${lowest ? `. Lowest ${lowest}${lowestName}` : ""}.`;
    } else if (count > 0 && processedCount >= count) {
      status.textContent = `✓ Recorded successfully. ${count} variation${count === 1 ? "" : "s"} checked${lowest ? `. Lowest ${lowest}${lowestName}` : ""}.`;
    } else if (record.collectionMode === "visible-fallback") {
      status.textContent = `✓ Recorded successfully${lowest ? `. Price ${lowest}` : ""}.`;
    } else {
      status.textContent = `✓ Recorded successfully${lowest ? `. Lowest ${lowest}${lowestName}` : ""}.`;
    }
    return true;
  }

  if (record?.state === "detected") {
    const count = Number(record.variationCount || 0);
    const lowest = formatPeso(record.price);
    const lowestName = record.lowestVariationName ? ` · ${record.lowestVariationName}` : "";

    detail.textContent = count > 0
      ? `Item ${ids.productId} · ${count} variation${count === 1 ? "" : "s"}`
      : `Item ${ids.productId}`;

    if (record.saveError) {
      status.textContent = "Saving did not finish. Retrying…";
      status.classList.add("error");
      requestRecording();
      scheduleStatusPolling();
      return false;
    }

    status.textContent = count > 0
      ? `Found ${count} variation${count === 1 ? "" : "s"}${lowest ? `. Lowest ${lowest}${lowestName}` : ""}. Saving prices…`
      : `Product found${lowest ? ` at ${lowest}` : ""}. Saving prices…`;

    if (recordAgeMs(record) > STALE_PROGRESS_MS) {
      status.textContent = "Saving is taking longer than expected. Retrying…";
      requestRecording();
    }

    scheduleStatusPolling();
    return false;
  }

  if (record?.state === "checking") {
    detail.textContent = `Item ${ids.productId}`;
    status.textContent = "Checking product…";
    if (recordAgeMs(record) > STALE_PROGRESS_MS) requestRecording();
    scheduleStatusPolling();
    return false;
  }

  if (record?.state === "error") {
    detail.textContent = `Item ${ids.productId}`;
    status.textContent = record.message || "Checking failed. Retrying…";
    status.classList.add("error");
    requestRecording();
    scheduleStatusPolling();
    return false;
  }

  detail.textContent = `Item ${ids.productId}`;
  status.textContent = "Checking product…";
  scheduleStatusPolling();
  return false;
}

function readStoredStatus() {
  if (!primaryKey || !legacyKey) return Promise.resolve(null);
  return new Promise(resolve => {
    chrome.storage.local.get([primaryKey, legacyKey], result => {
      const primaryRecord = result[primaryKey] || null;
      const legacyRecord = result[legacyKey] || null;

      // Prefer the newest record if both keys exist. This prevents a slightly
      // older legacy write from making the popup look stuck on "Saving...".
      const primaryTime = Date.parse(primaryRecord?.at || "") || 0;
      const legacyTime = Date.parse(legacyRecord?.at || "") || 0;
      const record = primaryTime >= legacyTime ? primaryRecord : legacyRecord;

      renderRecord(record);
      resolve(record);
    });
  });
}

function initializePopupToggle() {
  chrome.storage.local.get(POPUP_SETTING_KEY, result => {
    popupToggle.checked = result[POPUP_SETTING_KEY] === true;
  });

  popupToggle.addEventListener("change", () => {
    chrome.storage.local.set({ [POPUP_SETTING_KEY]: popupToggle.checked });
  });
}

async function initialize() {
  initializePopupToggle();

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = activeTab?.id;
  ids = parseIds(activeTab?.url || "");
  if (!ids) {
    title.textContent = "Open a Shopee product page";
    detail.textContent = "Automatic tracking works on supported products.";
    status.textContent = "No product data was collected from this page.";
    status.classList.add("error");
    return;
  }

  title.textContent = "Shopee product detected";
  detail.textContent = `Item ${ids.productId}`;
  status.textContent = "Checking product…";
  button.disabled = false;

  primaryKey = `productStatus:${ids.shopId}:${ids.productId}`;
  legacyKey = `productStatus:${ids.productId}`;
  const existing = await readStoredStatus();

  const staleProgress = existing && ["checking", "detected"].includes(existing.state) && recordAgeMs(existing) > STALE_PROGRESS_MS;
  if (activeTabId != null && (!existing || existing.state === "error" || existing.saveError || staleProgress)) {
    requestRecording();
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes[POPUP_SETTING_KEY]) {
    popupToggle.checked = changes[POPUP_SETTING_KEY].newValue === true;
  }

  if (!ids) return;

  if (changes[primaryKey] || changes[legacyKey]) {
    // Always resolve both keys together and render the newest status. This makes
    // the popup robust to write ordering between the primary and legacy keys.
    readStoredStatus();
  }
});

button.addEventListener("click", () => {
  const report = `${SITE}/?url=${encodeURIComponent(ids.canonicalUrl)}&autocheck=1#result`;
  requestRecording();
  chrome.tabs.create({ url: report });
});

initialize();
