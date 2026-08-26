// System/OS notifications are intentionally disabled.
// PriceTrack uses the in-page completion toast controlled by the Notifications toggle.

const SITE = "https://pricetrackph.com";

function productReportUrl(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)shopee\.ph$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/-i\.(\d+)\.(\d+)/i) || url.pathname.match(/\/product\/(\d+)\/(\d+)/i);
    if (!match) return null;
    const canonicalUrl = `${url.origin}${url.pathname}`;
    return `${SITE}/?url=${encodeURIComponent(canonicalUrl)}&autocheck=1#result`;
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "openPriceHistoryShortcut") return;
  const reportUrl = productReportUrl(message.url || "");
  if (reportUrl) chrome.tabs.create({ url: reportUrl });
});
