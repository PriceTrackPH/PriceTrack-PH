const shortcutInput = document.querySelector("#shortcut-input");
const enabledInput = document.querySelector("#enabled");
const saveButton = document.querySelector("#save");
const clearButton = document.querySelector("#clear");
const message = document.querySelector("#message");

function shortcutFromEvent(event) {
  const ignoredKeys = new Set(["Control", "Alt", "Shift", "Meta", "Tab"]);
  if (ignoredKeys.has(event.key)) return "";
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key);
  return parts.join("+");
}

chrome.storage.local.get(["shortcutKey", "shortcutEnabled"], (result) => {
  shortcutInput.value = typeof result.shortcutKey === "string" ? result.shortcutKey : "";
  enabledInput.checked = result.shortcutEnabled === true;
});

shortcutInput.addEventListener("keydown", (event) => {
  event.preventDefault();
  const shortcut = shortcutFromEvent(event);
  if (shortcut) shortcutInput.value = shortcut;
});

clearButton.addEventListener("click", () => {
  shortcutInput.value = "";
});

saveButton.addEventListener("click", () => {
  const shortcutKey = shortcutInput.value.trim();
  const shortcutEnabled = enabledInput.checked && Boolean(shortcutKey);
  chrome.storage.local.set({ shortcutKey, shortcutEnabled }, () => {
    enabledInput.checked = shortcutEnabled;
    message.textContent = shortcutKey ? "Settings saved." : "Shortcut cleared and disabled.";
  });
});
