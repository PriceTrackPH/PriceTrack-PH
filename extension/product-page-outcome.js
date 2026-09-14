(() => {
  function classifyProductPage(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!text) return null;
    if (/security verification|verify to continue|captcha|verification required/.test(text)) return "verification";
    if (/product doesn['’]?t exist|product does not exist|listing (?:has been )?(?:delisted|removed)|item (?:has been )?(?:delisted|removed)/.test(text)) {
      return /delisted|listing/.test(text) ? "unlisted" : "does_not_exist";
    }
    if (/page unavailable|it['’]?s us, not you|please try to refresh the page|sorry, something went wrong/.test(text)) return "page_error";
    return null;
  }

  globalThis.PriceTrackProductPageOutcome = { classifyProductPage };
})();
