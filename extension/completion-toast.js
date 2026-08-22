(() => {
  let lastToastKey = "";
  let toastTimer = null;

  function parseCurrentProduct() {
    try {
      const url = new URL(location.href);
      const match = url.pathname.match(/-i\.(\d+)\.(\d+)/i) || url.pathname.match(/\/product\/(\d+)\/(\d+)/i);
      if (!match) return null;
      return {
        shopId: match[1],
        productId: match[2],
        statusKey: `productStatus:${match[1]}:${match[2]}`,
      };
    } catch {
      return null;
    }
  }

  const currentProduct = parseCurrentProduct();

  function formatPeso(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0
      ? `₱${number.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`
      : "";
  }

  function clearToast() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    document.getElementById("pricetrack-recording-toast")?.remove();
  }

  function showToast(record) {
    if (!record || record.state !== "recorded") return;

    const key = `${record.at || ""}:${record.variationCount || 0}:${record.price || ""}`;
    if (key === lastToastKey) return;
    lastToastKey = key;

    clearToast();

    const count = Number(record.variationCount || 0);
    const lowest = formatPeso(record.price);
    const lowestName = record.lowestVariationName ? ` · ${record.lowestVariationName}` : "";
    const message = count > 1
      ? `All ${count} variations finished recording${lowest ? `. Lowest ${lowest}${lowestName}` : "."}`
      : `Price recording finished${lowest ? ` at ${lowest}${lowestName}` : "."}`;

    const toast = document.createElement("div");
    toast.id = "pricetrack-recording-toast";
    toast.setAttribute("role", "status");
    toast.style.cssText = [
      "position:fixed",
      "top:20px",
      "right:20px",
      "z-index:2147483647",
      "width:min(380px,calc(100vw - 40px))",
      "box-sizing:border-box",
      "padding:14px 16px",
      "border:1px solid #4b4388",
      "border-radius:10px",
      "background:#21185f",
      "color:#ffffff",
      "font:600 14px/1.4 Arial,sans-serif",
      "box-shadow:0 14px 38px rgba(0,0,0,.28)",
      "opacity:0",
      "transform:translateY(-8px)",
      "transition:opacity .18s ease,transform .18s ease"
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "PriceTrack PH";
    title.style.cssText = "font-size:15px;font-weight:800;margin-bottom:4px;color:#8cf1d2";

    const body = document.createElement("div");
    body.textContent = message;

    toast.append(title, body);
    (document.body || document.documentElement).appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });

    toastTimer = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-8px)";
      setTimeout(() => toast.remove(), 220);
      toastTimer = null;
    }, 7000);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !currentProduct) return;

    // Each Shopee tab listens only to its own shop + product status. This keeps
    // a completed notification from another/previous tab from appearing here.
    const change = changes[currentProduct.statusKey];
    if (!change) return;
    showToast(change.newValue);
  });

  // Closing/navigating away from this tab discards its toast state completely.
  window.addEventListener("pagehide", clearToast, { once: true });
})();
