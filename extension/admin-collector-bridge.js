(() => {
  const PAGE_SOURCE = "pricetrack-store-scan-page";
  const EXTENSION_SOURCE = "pricetrack-store-scan-extension";
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (window.location.origin !== "https://pricetrackph.com" || window.location.pathname !== "/admin/store-scanner") return;

  function validStoreUrl(value) {
    try {
      const url = new URL(String(value));
      return url.protocol === "https:" && url.hostname === "shopee.ph" && url.pathname.split("/").filter(Boolean).length === 1;
    } catch { return false; }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (message?.source !== PAGE_SOURCE || !UUID_V4.test(String(message.scanId || ""))) return;
    if (message.type === "completeAck") {
      chrome.runtime.sendMessage({ type: "storeScanCompletionAck", scanId: String(message.scanId), completed: message.completed === true }, () => undefined);
      return;
    }
    if (message.type !== "start" || !validStoreUrl(message.storeUrl)) return;
    chrome.runtime.sendMessage({ type: "startStoreScanSession", scanId: String(message.scanId), storeUrl: String(message.storeUrl) }, (response) => {
      window.postMessage({
        source: EXTENSION_SOURCE,
        type: response?.ok ? "ready" : "error",
        scanId: String(message.scanId),
        error: response?.error || undefined,
      }, "https://pricetrackph.com");
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "storeScanRelay" || !message.payload) return;
    window.postMessage({ source: EXTENSION_SOURCE, ...message.payload }, "https://pricetrackph.com");
  });
})();
