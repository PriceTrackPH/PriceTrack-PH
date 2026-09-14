(() => {
  function hasStructuredSoldOut(product) {
    const variations = Array.isArray(product?.variations) ? product.variations : [];
    return variations.length > 0 && variations.every(variation => variation?.isInStock === false);
  }

  function classifyProductPage(value, product = null) {
    const text = String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (/security verification|verify to continue|captcha|verification required/.test(text)) return "verification";

    if (
      hasStructuredSoldOut(product)
      || /\bsold out\b|out of stock|currently unavailable/.test(text)
    ) return "sold_out";

    if (/listing (?:has been )?(?:delisted|removed)|item (?:has been )?(?:delisted|removed)|\bdelisted\b/.test(text)) {
      return "unlisted";
    }

    if (/product doesn['’]?t exist|product does not exist|item doesn['’]?t exist|item does not exist/.test(text)) {
      return "does_not_exist";
    }

    if (/page unavailable|it['’]?s us, not you|please try to refresh the page|sorry, something went wrong/.test(text)) {
      return "page_error";
    }

    return null;
  }

  globalThis.PriceTrackProductPageOutcome = { classifyProductPage };
})();
