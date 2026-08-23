# PriceTrack PH

Independent marketplace price history and tracking for the Philippines.

## Overview

PriceTrack PH tracks public marketplace product prices, variations, stock state, and historical observations using the connected Supabase backend.

## Architecture

```text
Chrome extension
    |
    | POST detected product/variation data
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
- `product_variations`: one row per marketplace variation/model
- `price_observations`: historical observations for a specific variation
- `ingest_rate_limits`: private collector rate-limit state

Public users can read `products`, `product_variations`, and `price_observations`. Public access to `ingest_rate_limits` is denied by RLS.

## Variation behavior

The collector accepts a `variations` array so one product-page visit can submit all detected models. Price history is kept per variation, preventing a switch between two variants from being misreported as a price change on one variant.

## Brand

User-facing name: **PriceTrack PH**  
Technical/project slug: **pricetrack-ph**

## Repository safety

Do not commit:

- Supabase service-role/secret keys
- database passwords
- browser session cookies
- private API tokens
- local `.env` files
