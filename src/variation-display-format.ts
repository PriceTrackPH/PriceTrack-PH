const VARIATION_SELECTORS = [
  ".variation-option-name",
  ".variation-picker-button > span:first-child",
  ".history-heading p",
].join(",");

function formatVariationText(value: string) {
  return value.replace(/\s*[,，]\s*/g, " — ");
}

/*
 * Preserve React's DOM structure. Replacing element.textContent collapses React's
 * separate text nodes into one node, which can make the visible variation label
 * drift out of sync with selectedVariationId after changing options.
 */
function formatTextNodes(element: HTMLElement) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    const current = node.nodeValue;
    if (current && (current.includes(",") || current.includes("，"))) {
      const formatted = formatVariationText(current);
      if (formatted !== current) node.nodeValue = formatted;
    }
    node = walker.nextNode();
  }
}

function formatVisibleVariationLabels(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(VARIATION_SELECTORS).forEach(formatTextNodes);
}

/* Keep focus on the picker until React's option click runs. */
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
