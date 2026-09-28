const TITLE_SELECTOR = ".report-card .product-details h2";
const MIN_FONT_SIZE = 10;
const FONT_STEP = 0.5;

let scheduledFrame: number | null = null;

function fitTitleToTwoLines(title: HTMLElement) {
  const mobile = window.matchMedia("(max-width: 680px)").matches;
  const maxLines = mobile ? 4 : 2;
  const minimumSize = mobile ? 14 : MIN_FONT_SIZE;
  // Start from the normal CSS size each time, then shrink only when needed.
  title.style.removeProperty("font-size");
  title.style.removeProperty("display");
  title.style.removeProperty("-webkit-line-clamp");
  title.style.removeProperty("-webkit-box-orient");
  title.style.removeProperty("overflow");

  const baseSize = Number.parseFloat(window.getComputedStyle(title).fontSize) || 22;
  let fontSize = baseSize;

  const fitsInAvailableLines = () => {
    const computed = window.getComputedStyle(title);
    const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.28;
    return title.scrollHeight <= lineHeight * maxLines + 1;
  };

  while (fontSize > minimumSize && !fitsInAvailableLines()) {
    fontSize = Math.max(minimumSize, fontSize - FONT_STEP);
    title.style.setProperty("font-size", `${fontSize}px`, "important");
  }

  // Give mobile titles room to wrap while preserving the desktop layout.
  title.style.setProperty("display", "-webkit-box");
  title.style.setProperty("-webkit-box-orient", "vertical");
  title.style.setProperty("-webkit-line-clamp", String(maxLines));
  title.style.setProperty("overflow", "hidden");
}

function fitAllProductTitles() {
  document.querySelectorAll<HTMLElement>(TITLE_SELECTOR).forEach(fitTitleToTwoLines);
}

function scheduleTitleFit() {
  if (scheduledFrame !== null) return;

  scheduledFrame = window.requestAnimationFrame(() => {
    scheduledFrame = null;
    fitAllProductTitles();
  });
}

const root = document.getElementById("root");
if (root) {
  const observer = new MutationObserver(scheduleTitleFit);
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

window.addEventListener("resize", scheduleTitleFit);

if (document.fonts) {
  document.fonts.ready.then(scheduleTitleFit).catch(() => undefined);
}

scheduleTitleFit();
