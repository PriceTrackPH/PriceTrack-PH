(() => {
  const SOURCE = "pricetrack-ph-page";
  const REQUEST_SOURCE = "pricetrack-ph-extension";
  let lastProductPayload = null;

  function isProductDataUrl(value) {
    try {
      const url = new URL(String(value), location.href);
      if (!/(^|\.)shopee\.ph$/i.test(url.hostname)) return false;
      return /\/api\/v4\/(?:pdp\/(?:get|get_pc)|pdp\/cart_panel\/get|cart\/cart_panel\/get_rw)(?:[/?]|$)/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function looksLikeProductPayload(payload) {
    if (!payload || typeof payload !== "object") return false;
    const item = payload?.data?.item || payload?.item || payload?.data?.product?.item;
    return Boolean(item && (item.item_id || item.itemid) && (item.shop_id || item.shopid));
  }

  function publish(payload) {
    if (!looksLikeProductPayload(payload)) return;
    lastProductPayload = payload;
    window.postMessage({ source: SOURCE, type: "product-data", payload }, "*");
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = function (...args) {
      const request = args[0];
      const url = typeof request === "string" || request instanceof URL ? String(request) : request?.url;
      return nativeFetch.apply(this, args).then(response => {
        if (isProductDataUrl(url || response?.url || "")) {
          response.clone().json().then(publish).catch(() => {});
        }
        return response;
      });
    };
  }

  const NativeXHR = window.XMLHttpRequest;
  if (NativeXHR?.prototype) {
    const nativeOpen = NativeXHR.prototype.open;
    NativeXHR.prototype.open = function (method, url, ...rest) {
      this.__priceTrackUrl = String(url || "");
      this.addEventListener("load", function () {
        if (!isProductDataUrl(this.__priceTrackUrl || this.responseURL || "")) return;
        try {
          const payload = this.responseType === "json" ? this.response : JSON.parse(this.responseText || "null");
          publish(payload);
        } catch {}
      }, { once: true });
      return nativeOpen.call(this, method, url, ...rest);
    };
  }

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const message = event.data;
    if (message?.source !== REQUEST_SOURCE || message?.type !== "request-product-data") return;
    if (lastProductPayload) publish(lastProductPayload);
  });
})();
