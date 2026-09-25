const ICON_PATHS = {
  idle: { 16: "icons/icon-idle-16.png", 32: "icons/icon-idle-32.png", 48: "icons/icon-idle-48.png", 128: "icons/icon-idle-128.png" },
  recording: { 16: "icons/icon-recording-16.png", 32: "icons/icon-recording-32.png", 48: "icons/icon-recording-48.png", 128: "icons/icon-recording-128.png" },
  recorded: { 16: "icons/icon-recorded-16.png", 32: "icons/icon-recorded-32.png", 48: "icons/icon-recorded-48.png", 128: "icons/icon-recorded-128.png" },
  error: { 16: "icons/icon-error-16.png", 32: "icons/icon-error-32.png", 48: "icons/icon-error-48.png", 128: "icons/icon-error-128.png" },
};

async function apply(tabId, state, action = chrome.action) {
  const normalized = ["recording", "recorded", "error"].includes(state) ? state : "idle";
  await action.setIcon({ tabId, path: ICON_PATHS[normalized] });
}

globalThis.PriceTrackIconState = { apply };
