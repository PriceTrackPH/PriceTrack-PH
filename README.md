# Shopee & Lazada Price Tracker

Source repository for PriceTrack PH.

## Current migration status

This repository is being created from the live PriceTrack project and its connected Supabase backend.

Recovered from the live backend:

- Supabase table model for products, variations, and price observations
- Row-level security model for public read-only history
- `record-price` Edge Function v3 with bulk Shopee variation support
- Generated TypeScript database types

The original editable source behind the public `chatgpt.site` deployment is not exposed by the public URL, so the web UI in this repository is a clean source reconstruction rather than a copy of minified deployment output.

## Architecture

```text
Chrome extension
    |
    | POST all Shopee models/variations
    v
Supabase Edge Function: record-price
    |
    v
products -> product_variations -> price_observations
    |
    v
React web app -> public read-only price history
```

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Add the Supabase publishable key to `.env.local`.
4. Run `npm run dev`.

The Supabase project URL is already included in `.env.example`. Never place a service-role/secret key in frontend environment variables or commit one to GitHub.

## Database model

- `products`: marketplace-level product identity
- `product_variations`: one row per Shopee/Lazada variation/model
- `price_observations`: historical observations for a specific variation
- `ingest_rate_limits`: private collector rate-limit state

Public users can read `products`, `product_variations`, and `price_observations`. Public access to `ingest_rate_limits` is denied by RLS.

## Variation behavior

The collector accepts a `variations` array so one product-page visit can submit all detected Shopee models. Price history is kept per variation, preventing a switch between two variants from being misreported as a price change on one variant.

## Live site

Current public deployment: `https://shopee-price-history.vergel18.chatgpt.site/`

## Repository safety

Do not commit:

- Supabase service-role/secret keys
- database passwords
- browser session cookies
- private API tokens
- local `.env` files
