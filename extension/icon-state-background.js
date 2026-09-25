chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "setProductIconState" || !Number.isInteger(sender.tab?.id)) return;
  void globalThis.PriceTrackIconState.apply(sender.tab.id, message.state);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") void globalThis.PriceTrackIconState.apply(tabId, "idle");
});
