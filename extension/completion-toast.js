(() => {
  const POPUP_SETTING_KEY = "notificationsEnabled";
  let lastToastKey = "";
  const timings = new Map();

  function formatPeso(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0
      ? `₱${number.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`
      : "";
  }

  function formatSeconds(ms) {
    if (!Number.isFinite(ms) || ms < 0) return null;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function currentProductId() {
    return location.pathname.match(/-i\.\d+\.(\d+)/i)?.[1] ||
      location.pathname.match(/\/product\/\d+\/(\d+)/i)?.[1] || null;
  }

  function recordBelongsToThisTab(key) {
    const productId = currentProductId();
    if (!productId || !key.startsWith("productStatus:")) return false;
    return key.endsWith(`:${productId}`) || key === `productStatus:${productId}`;
  }

  function timingKey(key) {
    const productId = currentProductId() || key;
    return String(productId);
  }

  function rememberTiming(key, record) {
    if (!record?.at) return;
    const at = Date.parse(record.at);
    if (!Number.isFinite(at)) return;

    const id = timingKey(key);
    const timing = timings.get(id) || {};
    if (record.state === "checking") timing.checkingAt = at;
    if (record.state === "detected") timing.detectedAt = at;
    if (record.state === "recorded") timing.recordedAt = at;
    timings.set(id, timing);
  }

  function timingSummary() {
    const id = String(currentProductId() || "");
    const timing = timings.get(id);
    if (!timing) return "";

    const detectedMs = Number.isFinite(timing.checkingAt) && Number.isFinite(timing.detectedAt)
      ? timing.detectedAt - timing.checkingAt
      : null;
    const savedMs = Number.isFinite(timing.detectedAt) && Number.isFinite(timing.recordedAt)
      ? timing.recordedAt - timing.detectedAt
      : null;
    const totalMs = Number.isFinite(timing.checkingAt) && Number.isFinite(timing.recordedAt)
      ? timing.recordedAt - timing.checkingAt
      : null;

    const detected = formatSeconds(detectedMs);
    const saved = formatSeconds(savedMs);
    const total = formatSeconds(totalMs);
    if (!detected && !saved && !total) return "";

    return [
      detected ? `Detected ${detected}` : null,
      saved ? `Saved ${saved}` : null,
      total ? `Total ${total}` : null,
    ].filter(Boolean).join(" · ");
  }

  function showToast(record) {
    if (!record || record.state !== "recorded") return;

    const key = `${record.at || ""}:${record.variationCount || 0}:${record.price || ""}`;
    if (key === lastToastKey) return;
    lastToastKey = key;

    const existing = document.getElementById("pricetrack-recording-toast");
    if (existing) existing.remove();

    const count = Number(record.variationCount || 0);
    const lowest = formatPeso(record.price);
    const lowestName = record.lowestVariationName ? ` · ${record.lowestVariationName}` : "";
    const message = count > 1
      ? `All ${count} variations finished recording${lowest ? `. Lowest ${lowest}${lowestName}` : "."}`
      : `Price recording finished${lowest ? ` at ${lowest}${lowestName}` : "."}`;
    const timingText = timingSummary();

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

    if (timingText) {
      const timing = document.createElement("div");
      timing.textContent = timingText;
      timing.style.cssText = "margin-top:6px;font-size:12px;font-weight:700;color:#c9c5ff";
      toast.appendChild(timing);
    }

    (document.body || document.documentElement).appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-8px)";
      setTimeout(() => toast.remove(), 220);
    }, 7000);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    for (const [key, change] of Object.entries(changes)) {
      if (!recordBelongsToThisTab(key)) continue;
      const record = change.newValue;
      if (!record) continue;

      rememberTiming(key, record);
      if (record.state !== "recorded") continue;

      chrome.storage.local.get(POPUP_SETTING_KEY, result => {
        if (result[POPUP_SETTING_KEY] !== true) return;
        showToast(record);
      });
    }
  });
})();
