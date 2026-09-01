# Migration notes

## What was recoverable

The connected Supabase project exposes the database schema and the deployed `record-price` Edge Function source. Those are represented directly in this repository.

## What was not recoverable from the public URL

The public `chatgpt.site` deployment does not expose the original editable project/source workspace. The React UI in this repository is therefore a clean reconstruction of the current tracker behavior rather than copied hidden source.

The original Chrome extension source is also not available from the public site URL. The backend contract already supports bulk variation submission; the extension source should be added here once recovered or rebuilt.

## Current verified backend behavior

- Products are unique by `(platform, external_shop_id, external_product_id)`.
- Variations are unique by `(product_id, external_variation_id)`.
- Price history belongs to a variation, not directly to a product.
- Public RLS permits SELECT on products, variations, and observations.
- Public RLS denies access to `ingest_rate_limits`.
- The collector accepts up to 200 variations in one submission.
- The first observation for each variation is retained on every Manila calendar day, even when the price is unchanged.
- Repeated observations with the same price and stock state are not duplicated again within that same Manila day.
- The collector returns the lowest in-stock submitted variation.

## Next migration step

Recover or rebuild the Chrome extension so it extracts every Shopee model ID, name, price, stock state, SKU, and original price and sends them in the `variations` array expected by `record-price`.
