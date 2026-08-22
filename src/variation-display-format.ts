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

/*
 * The variation menu lives inside a focus-managed picker in App.tsx. Browsers can
 * fire blur on the picker button before the option's click handler runs. When that
 * happens the menu is removed and React never receives the selection click, making
 * the report appear stuck on the previous variation.
 *
 * Keep focus on the picker until React's option onClick runs. The click event still
 * fires normally, so App.tsx updates selectedVariationId and every derived value
 * (current price, stock status, stats, observation count and chart) re-renders for
 * the newly selected variation.
 */
function preserveVariationOptionClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest(".variation-option")) return;
  event.preventDefault();
}

document.addEventListener("mousedown", preserveVariationOptionClick, true);

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
