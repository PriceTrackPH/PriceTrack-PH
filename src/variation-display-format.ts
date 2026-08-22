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

function measureTextWidth(text: string, element: HTMLElement) {
  const styles = window.getComputedStyle(element);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return 0;

  context.font = [
    styles.fontStyle,
    styles.fontVariant,
    styles.fontWeight,
    styles.fontSize,
    styles.fontFamily,
  ].join(" ");

  const letterSpacing = styles.letterSpacing === "normal"
    ? 0
    : Number.parseFloat(styles.letterSpacing) || 0;

  return context.measureText(text).width
    + Math.max(0, text.length - 1) * letterSpacing;
}

/*
 * App.tsx measures the raw database name before this file converts commas to the
 * visible " — " separator, and that old measurement also did not reserve space for
 * the chevron/gap. That is why the right side looked cramped even with equal CSS
 * padding. Re-measure the actual visible label here and include every horizontal
 * piece of the closed button.
 *
 * When the menu is open, measure every variation so the closed button keeps one
 * stable width based on the longest label. Until the menu has been opened once,
 * size it correctly for the currently selected label.
 */
function syncVariationPickerWidth() {
  document.querySelectorAll<HTMLElement>(".variation-picker").forEach((picker) => {
    const button = picker.querySelector<HTMLButtonElement>(".variation-picker-button");
    const label = button?.querySelector<HTMLElement>(":scope > span:first-child");
    const chevron = button?.querySelector<HTMLElement>(".variation-chevron");
    if (!button || !label) return;

    const buttonStyles = window.getComputedStyle(button);
    const horizontalPadding = (Number.parseFloat(buttonStyles.paddingLeft) || 0)
      + (Number.parseFloat(buttonStyles.paddingRight) || 0);
    const horizontalBorders = (Number.parseFloat(buttonStyles.borderLeftWidth) || 0)
      + (Number.parseFloat(buttonStyles.borderRightWidth) || 0);
    const gap = Number.parseFloat(buttonStyles.columnGap || buttonStyles.gap) || 0;
    const chevronWidth = chevron?.getBoundingClientRect().width ?? 0;

    let longest = measureTextWidth(label.textContent?.trim() ?? "", label);

    const options = picker.querySelectorAll<HTMLElement>(".variation-option");
    if (options.length) {
      options.forEach((option) => {
        const name = option.querySelector<HTMLElement>(".variation-option-name")?.textContent?.trim() ?? "";
        const unavailable = Boolean(option.querySelector("small"));
        const closedLabel = `${name}${unavailable ? " — Out of stock" : ""}`;
        longest = Math.max(longest, measureTextWidth(closedLabel, label));
      });

      picker.dataset.measuredVariationWidth = String(
        Math.ceil(longest + horizontalPadding + horizontalBorders + gap + chevronWidth),
      );
    }

    const stored = Number.parseFloat(picker.dataset.measuredVariationWidth || "");
    const width = Number.isFinite(stored)
      ? stored
      : Math.ceil(longest + horizontalPadding + horizontalBorders + gap + chevronWidth);

    picker.style.width = `${Math.min(430, width)}px`;
  });
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
    syncVariationPickerWidth();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", scheduleFormat, { once: true });
} else {
  scheduleFormat();
}

void document.fonts.ready.then(scheduleFormat);

const observer = new MutationObserver(scheduleFormat);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});
