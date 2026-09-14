(() => {
  function finiteNumber(value, minimum = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= minimum ? number : null;
  }

  function extractProductActivity(item) {
    if (!item || typeof item !== "object") return null;
    const result = {
      totalSold: finiteNumber(item.historical_sold ?? item.sold),
      viewCount: finiteNumber(item.view_count ?? item.views),
      reviewCount: finiteNumber(item.cmt_count ?? item.review_count),
      favoriteCount: finiteNumber(item.liked_count ?? item.favorite_count),
      rating: finiteNumber(item.item_rating?.rating_star ?? item.rating_star),
      discountPercent: finiteNumber(item.raw_discount ?? item.discount),
    };
    return Object.values(result).some((value) => value !== null) ? result : null;
  }

  globalThis.PriceTrackProductActivity = { extractProductActivity };
})();
