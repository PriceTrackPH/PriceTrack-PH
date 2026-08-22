const VARIATION_SELECTORS = [
  ".variation-option-name",
  ".variation-picker-button > span:first-child",
  ".history-heading p",
].join(",");

function formatVariationText(value: string) {
  return value.replace(/\s*[,，]\s*/g, " — ");
}

function formatVisibleVariationLabels(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(VARIATION_SELECTORS).forEach((element) => {
    const current = element.textContent;
    if (!current || (!current.includes(",") && !current.includes("，"))) return;

    const formatted = formatVariationText(current);
    if (formatted !== current) element.textContent = formatted;
  });
}

let frame = 0;
function scheduleFormat() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    formatVisibleVariationLabels();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", scheduleFormat, { once: true });
} else {
  scheduleFormat();
}

const observer = new MutationObserver(scheduleFormat);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});
