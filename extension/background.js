function formatPeso(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? `₱${number.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`
    : "";
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith("productStatus:")) continue;

    const record = change.newValue;
    if (!record || record.state !== "recorded") continue;

    const previous = change.oldValue;
    if (previous?.state === "recorded" && previous?.at === record.at) continue;

    const count = Number(record.variationCount || 0);
    const lowest = formatPeso(record.price);
    const lowestName = record.lowestVariationName ? ` · ${record.lowestVariationName}` : "";
    const message = count > 1
      ? `All ${count} variations finished recording${lowest ? `. Lowest ${lowest}${lowestName}` : "."}`
      : `Price recording finished${lowest ? ` at ${lowest}${lowestName}` : "."}`;

    chrome.notifications.create({
      type: "basic",
      iconUrl: "notification-icon.svg",
      title: "PriceTrack PH",
      message,
      priority: 1,
    });
  }
});
