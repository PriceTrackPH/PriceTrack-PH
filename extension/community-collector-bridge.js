// Community Collector compatibility. Admin behavior is intentionally untouched.
(() => {
  const url=new URL(location.href);
  if(url.searchParams.get('ptph_community')!=='1' || !window.opener) return;
  if(!window.name.startsWith('ptph-community-')) window.name='ptph-community-product';
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

  function report() {
    const match=location.pathname.match(/\/product\/(\d+)\/(\d+)/)||location.pathname.match(/-i\.(\d+)\.(\d+)/);
    if(!match)return;
    const identity={shopId:match[1],externalProductId:match[2]};
    window.opener.postMessage({source:'pricetrack-ph-collector-product',type:'collector-ready',...identity},'https://pricetrackph.com');
    const text=document.body?.innerText||'';
    const outcome=/your account has been (?:temporarily )?restricted due to automated tools detected/i.test(text)?'account_restricted':globalThis.PriceTrackProductPageOutcome.classifyProductPage(text);
    if(outcome)window.opener.postMessage({source:'pricetrack-ph-collector-product',type:'product-outcome',...identity,outcome},'https://pricetrackph.com');
  }
  report();
  const timer=setInterval(report,1000);
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
})();
