import assert from "node:assert/strict";
import test from "node:test";

import { buildOfferSummary, renderProductPage } from "../api/product-page.js";

const shell = `<!doctype html><html><head>
  <meta name="description" content="Home" />
  <link rel="canonical" href="https://pricetrackph.com/" />
  <meta property="og:title" content="Home" />
  <meta property="og:description" content="Home" />
  <meta property="og:url" content="https://pricetrackph.com/" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Home" />
  <meta name="twitter:description" content="Home" />
  <title>Home</title>
</head><body><div id="root"></div></body></html>`;

const product = {
  name: "Example cleaner",
  shop_name: "Example Shop",
  image_url: "https://example.com/product.jpg",
};

const canonicalUrl = "https://pricetrackph.com/product/shopee/123/456";

function productItems(html) {
  return [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => JSON.parse(match[1]))
    .flatMap((value) => value["@graph"] ?? [value])
    .flatMap((value) => value.mainEntity ? [value.mainEntity] : [])
    .filter((value) => value?.["@type"] === "Product");
}

test("buildOfferSummary uses the latest price from each active variation", () => {
  const summary = buildOfferSummary([
    { is_active: true, price_observations: [{ price: 129, is_in_stock: true, observed_at: "2026-09-07T01:00:00Z" }] },
    { is_active: true, price_observations: [{ price: 98, is_in_stock: true, observed_at: "2026-09-07T02:00:00Z" }] },
    { is_active: false, price_observations: [{ price: 50, is_in_stock: true, observed_at: "2026-09-07T03:00:00Z" }] },
  ]);

  assert.deepEqual(summary, {
    lowPrice: 98,
    highPrice: 129,
    offerCount: 2,
    availability: "https://schema.org/InStock",
  });
});

test("product HTML contains one valid PHP aggregate offer", () => {
  const html = renderProductPage(shell, product, canonicalUrl, {
    lowPrice: 98,
    highPrice: 129,
    offerCount: 2,
    availability: "https://schema.org/InStock",
  });
  const items = productItems(html);

  assert.equal(items.length, 1);
  assert.deepEqual(items[0].offers, {
    "@type": "AggregateOffer",
    url: canonicalUrl,
    priceCurrency: "PHP",
    lowPrice: 98,
    highPrice: 129,
    offerCount: 2,
    availability: "https://schema.org/InStock",
  });
});

test("product HTML omits Product markup when no valid current price exists", () => {
  const html = renderProductPage(shell, product, canonicalUrl, null);

  assert.equal(productItems(html).length, 0);
});
