function notifyWhenRecorded(key, record) {
  if (!key.startsWith("productStatus:")) return;
  if (!record || record.state !== "recorded") return;

  chrome.runtime.sendMessage({
    type: "recordingComplete",
    record: {
      ...record,
      productId: location.pathname.match(/-i\.\d+\.(\d+)/i)?.[1] ||
        location.pathname.match(/\/product\/\d+\/(\d+)/i)?.[1] || null,
    },
  }, () => void chrome.runtime.lastError);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  for (const [key, change] of Object.entries(changes)) {
    notifyWhenRecorded(key, change.newValue);
  }
});
