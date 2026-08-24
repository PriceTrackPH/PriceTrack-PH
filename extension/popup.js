const SITE = "https://pricetrackph.vercel.app";
const button = document.querySelector("#open");
const title = document.querySelector("#title");
const detail = document.querySelector("#detail");
const status = document.querySelector("#status");
const popupToggle = document.querySelector("#popup-toggle");
const POPUP_SETTING_KEY = "notificationsEnabled";
let ids;
let activeTabId;
let primaryKey;
let legacyKey;

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

function renderRecord(record) {
  status.classList.remove("error");

  if (record?.state === "recorded") {
    const count = Number(record.variationCount || 0);
    detail.textContent = count > 0
      ? `Item ${ids.productId} · ${count} variation${count === 1 ? "" : "s"}`
      : `Item ${ids.productId}`;

    const lowest = formatPeso(record.price);
    const lowestName = record.lowestVariationName ? ` · ${record.lowestVariationName}` : "";
    const processedCount = Number(record.recordedCount || 0) + Number(record.unchangedCount || 0);

    if (count > 1 && processedCount >= count) {
      status.textContent = `✓ All ${count} variations finished recording${lowest ? `. Lowest ${lowest}${lowestName}` : ""}.`;
    } else if (count > 1) {
      status.textContent = `Checked ${count} variations automatically${lowest ? `. Lowest ${lowest}${lowestName}` : ""}.`;
    } else if (record.collectionMode === "visible-fallback") {
      status.textContent = `Checked the visible price${lowest ? `: ${lowest}` : ""}. Reload the product page if Shopee variation data was still loading.`;
    } else {
      status.textContent = `Public price checked automatically${lowest ? `: ${lowest}` : ""}.`;
    }
    return true;
  }

  if (record?.state === "detected") {
    const count = Number(record.variationCount || 0);
    detail.textContent = count > 0
      ? `Item ${ids.productId} · ${count} variation${count === 1 ? "" : "s"}`
      : `Item ${ids.productId}`;

    const lowest = formatPeso(record.price);
    const lowestName = record.lowestVariationName ? ` · ${record.lowestVariationName}` : "";
    status.textContent = count > 1
      ? `Detected ${count} variations${lowest ? `. Lowest ${lowest}${lowestName}` : ""}. Saving price history…`
      : `Product price detected${lowest ? `: ${lowest}` : ""}. Saving price history…`;
    return true;
  }

  if (record?.state === "checking") {
    detail.textContent = `Item ${ids.productId}`;
    status.textContent = "Checking product variations…";
    return false;
  }

  if (record?.state === "error") {
    detail.textContent = `Item ${ids.productId}`;
    status.textContent = record.message || "Automatic checking will retry when this product page is refreshed.";
    status.classList.add("error");
    return true;
  }

  detail.textContent = `Item ${ids.productId}`;
  status.textContent = "Checking product variations…";
  return false;
}

function readStoredStatus() {
  if (!primaryKey || !legacyKey) return Promise.resolve(null);
  return new Promise(resolve => {
    chrome.storage.local.get([primaryKey, legacyKey], result => {
      const record = result[primaryKey] || result[legacyKey] || null;
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
  status.textContent = "Checking product variations…";
  button.disabled = false;

  primaryKey = `productStatus:${ids.shopId}:${ids.productId}`;
  legacyKey = `productStatus:${ids.productId}`;
  const existing = await readStoredStatus();

  if (activeTabId != null && (!existing || existing.state === "error")) {
    chrome.tabs.sendMessage(activeTabId, { type: "recordPriceNow" }, () => void chrome.runtime.lastError);
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes[POPUP_SETTING_KEY]) {
    popupToggle.checked = changes[POPUP_SETTING_KEY].newValue === true;
  }

  if (!ids) return;
  if (changes[primaryKey]) {
    renderRecord(changes[primaryKey].newValue);
  } else if (changes[legacyKey]) {
    renderRecord(changes[legacyKey].newValue);
  }
});

button.addEventListener("click", () => {
  const report = `${SITE}/?url=${encodeURIComponent(ids.canonicalUrl)}&autocheck=1#result`;
  chrome.tabs.sendMessage(activeTabId, { type: "recordPriceNow" }, () => void chrome.runtime.lastError);
  chrome.tabs.create({ url: report });
});

initialize();
