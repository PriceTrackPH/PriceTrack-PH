function formatPeso(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? `₱${number.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`
    : "";
}

const recentNotifications = new Map();

function notificationKey(record) {
  return `${record?.productId || "product"}:${record?.at || ""}:${record?.variationCount || 0}`;
}

function showRecordingNotification(record = {}) {
  if (!record || record.state !== "recorded") return;

  const key = notificationKey(record);
  const lastShown = recentNotifications.get(key) || 0;
  if (Date.now() - lastShown < 10000) return;
  recentNotifications.set(key, Date.now());

  const count = Number(record.variationCount || 0);
  const lowest = formatPeso(record.price);
  const lowestName = record.lowestVariationName ? ` · ${record.lowestVariationName}` : "";
  const message = count > 1
    ? `All ${count} variations finished recording${lowest ? `. Lowest ${lowest}${lowestName}` : "."}`
    : `Price recording finished${lowest ? ` at ${lowest}${lowestName}` : "."}`;

  chrome.notifications.create(`pricetrack-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("notification-icon.svg"),
    title: "PriceTrack PH",
    message,
    priority: 2,
    requireInteraction: false,
  }, () => {
    if (chrome.runtime.lastError) {
      console.error("PriceTrack notification failed:", chrome.runtime.lastError.message);
    }
  });
}

// Direct path: the Shopee tab tells the service worker immediately when the
// current product reaches the recorded state. This works even when the popup
// was never opened.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "recordingComplete" || !message.record) return false;
  showRecordingNotification(message.record);
  sendResponse({ ok: true });
  return false;
});

// Keep storage changes as a fallback in case the direct tab message is missed.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith("productStatus:")) continue;

    const record = change.newValue;
    if (!record || record.state !== "recorded") continue;

    const previous = change.oldValue;
    if (previous?.state === "recorded" && previous?.at === record.at) continue;
    showRecordingNotification(record);
  }
});
