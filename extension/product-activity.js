(() => {
  function finiteNumber(value, minimum = 0) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= minimum ? number : null;
  }

  // Shopee sometimes renders these counts without including them in the PDP
  // payload. Visible K/M labels are rounded lower bounds, not exact totals.
  function visibleCount(value) {
    const match = String(value || "").replace(/,/g, "").trim().match(/^(\d+(?:\.\d+)?)\s*([KM])?\+?$/i);
    if (!match) return null;
    const multiplier = match[2]?.toUpperCase() === "M" ? 1_000_000 : match[2]?.toUpperCase() === "K" ? 1_000 : 1;
    const count = Number(match[1]) * multiplier;
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  }

  function extractVisibleProductActivity(root, title) {
    const page = String(root?.body?.innerText || "");
    if (!page || !title) return null;
    // Only inspect the product header. Store ratings, follower counts and
    // recommended listings lower on the page belong to other entities.
    const beforeShop = page.split(/\b(?:Product Specifications|Product Description|View Shop|Chat Now)\b/i)[0];
    const productStart = beforeShop.toLowerCase().lastIndexOf(String(title).trim().toLowerCase());
    if (productStart < 0) return null;
    const header = beforeShop.slice(productStart, productStart + 4000);
    const sold = header.match(/\b(\d+(?:[.,]\d+)?\s*[KM]?\+?)\s+Sold\b/i);
    const ratings = header.match(/\b(\d+(?:[.,]\d+)?\s*[KM]?\+?)\s+Ratings\b/i);
    const favorites = header.match(/\bFavorite\s*\(\s*(\d+(?:[.,]\d+)?\s*[KM]?\+?)\s*\)/i);
    const result = {
      totalSold: visibleCount(sold?.[1]),
      // A ratings count is not necessarily the number of written reviews.
      // Keep it separate until the product schema has a ratings-count field.
      favoriteCount: visibleCount(favorites?.[1]),
      ratingCount: visibleCount(ratings?.[1]),
    };
    return Object.values(result).some(value => value !== null) ? result : null;
  }

  function mergeProductActivity(apiActivity, visibleActivity) {
    if (!apiActivity && !visibleActivity) return null;
    return {
      ...(apiActivity || {}),
      totalSold: apiActivity?.totalSold ?? visibleActivity?.totalSold ?? null,
      favoriteCount: apiActivity?.favoriteCount ?? visibleActivity?.favoriteCount ?? null,
      ratingCount: apiActivity?.ratingCount ?? visibleActivity?.ratingCount ?? null,
      ratingCountsByStar: apiActivity?.ratingCountsByStar ?? null,
      approximateRatingCount: apiActivity?.ratingCount == null && visibleActivity?.ratingCount != null,
      approximateTotalSold: apiActivity?.totalSold == null && visibleActivity?.totalSold != null,
      approximateFavoriteCount: apiActivity?.favoriteCount == null && visibleActivity?.favoriteCount != null,
    };
  }

  function extractProductActivity(item) {
    if (!item || typeof item !== "object") return null;
    // Shopee's rating_count is [total, 1 star, 2 stars, 3 stars, 4 stars, 5 stars].
    // Reject incomplete or inconsistent breakdowns rather than saving guessed totals.
    const counts = item.product_review?.rating_count;
    const validCounts = Array.isArray(counts) && counts.length === 6 &&
      counts.every(count => Number.isSafeInteger(count) && count >= 0) &&
      counts.slice(1).reduce((sum, count) => sum + count, 0) === counts[0] &&
      (item.product_review.total_rating_count == null ||
        item.product_review.total_rating_count === counts[0]) ? counts : null;
    const result = {
      totalSold: finiteNumber(item.historical_sold ?? item.sold),
      viewCount: finiteNumber(item.view_count ?? item.views),
      reviewCount: finiteNumber(item.cmt_count ?? item.review_count),
      favoriteCount: finiteNumber(item.liked_count ?? item.favorite_count),
      rating: finiteNumber(item.item_rating?.rating_star ?? item.rating_star),
      discountPercent: finiteNumber(item.raw_discount ?? item.discount),
      ...(validCounts ? {
        ratingCount: validCounts[0],
        ratingCountsByStar: validCounts.slice(),
      } : {}),
    };
    return Object.values(result).some((value) => value !== null) ? result : null;
  }

  globalThis.PriceTrackProductActivity = { extractProductActivity, extractVisibleProductActivity, mergeProductActivity };
})();
