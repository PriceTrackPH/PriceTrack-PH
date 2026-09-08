// System/OS notifications are intentionally disabled.
// PriceTrack uses the in-page completion toast controlled by the Notifications toggle.

const SITE = "https://pricetrackph.com";
const STORE_SCAN_TTL_MS = 10 * 60_000;
const STORE_SCAN_STORAGE_KEY = "activeStoreScans";
const STORE_SCAN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storeScanSessions = new Map();

function validStoreUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && url.hostname === "shopee.ph" && url.pathname.split("/").filter(Boolean).length === 1;
  } catch { return false; }
}

function validStart(message) {
  return message?.type === "startStoreScanSession" && STORE_SCAN_UUID.test(String(message.scanId || "")) && validStoreUrl(message.storeUrl);
}

function sessionExpired(session, now = Date.now()) {
  return !session || !Number.isFinite(session.startedAt) || now - session.startedAt >= STORE_SCAN_TTL_MS;
}

globalThis.PriceTrackStoreCoordinator = { validStart, sessionExpired };

async function persistStoreScans() {
  if (!chrome.storage?.session) return;
  await chrome.storage.session.set({ [STORE_SCAN_STORAGE_KEY]: [...storeScanSessions.values()] });
}

async function loadStoreScans() {
  if (!chrome.storage?.session) return;
  const stored = await chrome.storage.session.get(STORE_SCAN_STORAGE_KEY);
  for (const session of Array.isArray(stored?.[STORE_SCAN_STORAGE_KEY]) ? stored[STORE_SCAN_STORAGE_KEY] : []) {
    if (!sessionExpired(session)) storeScanSessions.set(session.scanId, session);
  }
}

void loadStoreScans();

function productReportUrl(value, variationId) {
  try {
    const url = new URL(value);
    if (!/(^|\.)shopee\.ph$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/-i\.(\d+)\.(\d+)/i) || url.pathname.match(/\/product\/(\d+)\/(\d+)/i);
    if (!match) return null;
    const canonicalUrl = `${url.origin}${url.pathname}`;
    const variation = variationId ? `&variation=${encodeURIComponent(variationId)}` : "";
    return `${SITE}/?url=${encodeURIComponent(canonicalUrl)}&autocheck=1${variation}#result`;
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "openPriceHistoryShortcut") {
    const reportUrl = productReportUrl(message.url || "", message.variationId || "");
    if (reportUrl) chrome.tabs.create({ url: reportUrl });
    return;
  }
  if (validStart(message)) {
    const adminTabId = sender.tab?.id;
    if (!Number.isInteger(adminTabId)) { sendResponse?.({ ok: false, error: "Open the private collector page first." }); return; }
    const existing = [...storeScanSessions.values()].find((entry) => entry.adminTabId === adminTabId && !sessionExpired(entry));
    const saveTab = async (tab) => {
      if (!Number.isInteger(tab?.id)) { sendResponse?.({ ok: false, error: "Unable to open the Shopee store tab." }); return; }
      if (existing) storeScanSessions.delete(existing.scanId);
      storeScanSessions.set(message.scanId, { scanId: message.scanId, storeUrl: message.storeUrl, adminTabId, storeTabId: tab.id, startedAt: Date.now() });
      await persistStoreScans();
      sendResponse?.({ ok: true });
    };
    if (existing?.storeTabId) chrome.tabs.update(existing.storeTabId, { url: message.storeUrl, active: true }, saveTab);
    else chrome.tabs.create({ url: message.storeUrl, active: true }, saveTab);
    return true;
  }
  if (message?.type === "storeScanProgress" || message?.type === "storeScanFinished") {
    const session = storeScanSessions.get(String(message.scanId || ""));
    if (!session || sessionExpired(session) || sender.tab?.id !== session.storeTabId) return;
    chrome.tabs.sendMessage(session.adminTabId, { type: "storeScanRelay", payload: message });
    if (message.type === "storeScanFinished") {
      storeScanSessions.delete(session.scanId);
      void persistStoreScans();
    }
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  const session = [...storeScanSessions.values()].find((entry) => entry.storeTabId === tabId && !sessionExpired(entry));
  if (session) chrome.tabs.sendMessage(tabId, { type: "startStoreScan", scanId: session.scanId, storeUrl: session.storeUrl });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [scanId, session] of storeScanSessions) {
    if (session.adminTabId !== tabId && session.storeTabId !== tabId) continue;
    if (session.adminTabId !== tabId) chrome.tabs.sendMessage(session.adminTabId, {
      type: "storeScanRelay",
      payload: { type: "storeScanFinished", scanId, status: "incomplete", error: "The Shopee store tab was closed." },
    });
    storeScanSessions.delete(scanId);
  }
  void persistStoreScans();
});
