# Shopee Store Import Queue Design

Date: September 7, 2026

## Goal

Let the private PriceTrack PH collector scan a Shopee Philippines store page, discover its public product links, and persistently queue new products for normal price collection. Store products must use the existing extension-based recording flow so PriceTrack stores verified product names, images, variations, availability, and prices rather than incomplete data from the store listing.

## Fixed scope

This change adds a store URL input, store scanner, private store queue, collector toggle, status counts, and the extension support needed to discover links. It does not change the public/mobile priority queue, its 100-request daily allowance, sold-out scheduling, same-price scheduling, the 50-success run limit, the one-hour cooldown, or existing product-recording validation.

## Admin experience

The existing `/admin/collector` page adds:

- A Shopee store URL input.
- A `Scan store` button.
- A scan status showing discovered, newly queued, duplicate/already queued, and already tracked totals.
- A private `Saved stores` list showing each store, its last scan date, last discovered count, and a `Recheck` button.
- An `Include store-imported products` checkbox, enabled by default.
- A `Store queue pending: N` line in collector status.

Scanning does not automatically start collection. After the scan finishes, the administrator reviews the totals and clicks the existing `Start collection` button.

After a store completes its first successful or partially successful scan, its normalized store URL is saved once. The administrator can later use its `Recheck` button without pasting the URL again. Rechecking repeats discovery, updates the saved store's scan metadata, and queues only newly discovered untracked products. Rechecking is manual and has no automatic schedule in this change.

The checkbox controls only whether pending store imports participate in a run. Turning it off leaves the queue intact for a later run. Its state is sent to the server with collector claims and is not carried through a Shopee URL query string.

## Store scanning flow

1. The administrator pastes a supported `shopee.ph` store URL and clicks `Scan store`.
2. The admin page opens or reuses a dedicated Shopee store tab containing a short-lived, non-secret scan identifier.
3. The updated PriceTrack PH extension recognizes an authorized scan initiated by the PriceTrack collector.
4. The extension scrolls the store's product list until no new product cards appear or a safe stopping condition is reached.
5. The extension extracts only stable Shopee product identities: shop ID and item ID.
6. The extension reports batches to the originating PriceTrack admin page through a narrowly validated browser message channel.
7. The admin page sends the normalized identities to a private authenticated server endpoint.
8. The endpoint deduplicates them against tracked products and pending store imports, then returns final totals.

The UI must say that the scan found all products visible to that browser session, not guarantee hidden, deleted, region-restricted, or login-restricted listings.

## Collection order

When `Include store-imported products` is enabled, each claim follows this order:

1. Existing public/mobile priority queue, oldest eligible request first.
2. Private store-import queue, oldest eligible import first.
3. Existing normal due-product database selection.

When the checkbox is disabled, step 2 is skipped. Store imports and normal products both count toward the same existing 50-success run limit. Reaching the limit still stops the run and starts the existing one-hour cooldown. A 172-product store therefore normally completes over at least four runs, depending on priority requests, failures, sold-out results, and products already tracked.

## Queue identity and persistence

The private store queue uses marketplace, shop ID, and item ID as its stable identity.

- Repeated links within one scan are counted once.
- Rescanning the same store does not create duplicate active queue rows.
- Already tracked products are not queued.
- Pending, leased, completed, and removed states preserve recovery and auditability.
- Store queue entries persist across browser restarts, collector stops, cooldowns, and toggle changes.
- A product successfully recorded through any valid PriceTrack extension completes its matching store-queue entry.

Rescanning is allowed and is the supported way to discover products added to the Shopee store later.

## Data model

Add a private `store_collection_requests` table containing:

- Marketplace, shop ID, and item ID identity.
- Canonical PriceTrack-compatible Shopee product URL.
- Normalized source store URL and optional store slug for audit display.
- First-discovered and last-seen timestamps.
- Status: pending, leased, completed, or removed.
- Lease timestamp and attempt metadata for safe collector recovery.
- Completion timestamp.

Add a private `collection_stores` table containing:

- Stable store identity and normalized Shopee store URL.
- Store slug or display label when available.
- First-added timestamp.
- Last scan start and finish timestamps.
- Last scan status: completed, incomplete, or failed.
- Last discovered, newly queued, duplicate, and already tracked totals.

Only one saved row may exist for the same normalized Shopee store identity. A fresh paste and a later `Recheck` use the same saved-store record.

Database constraints allow only one active request per product. Database functions atomically insert scan batches, claim the oldest pending store request, release failed or interrupted leases, complete matching requests after recording, and return the private pending count. These tables and functions are not publicly readable.

## Interfaces

- Add a private authenticated store-import API for validated batches and summary counts.
- Add private authenticated list and recheck operations for saved stores.
- Extend `/api/admin-pc-collector?action=claim` with an `includeStoreImports` option.
- Preserve priority-first behavior, then attempt a store claim when enabled, then fall back to normal database selection.
- Extend the collector status response with `storeQueuePending`.
- Extend release handling to return interrupted store leases to pending.
- Extend the successful `record-price` path to complete matching public-priority and store-import requests.
- Update the extension content script/bridge to run a store scan only when initiated from the private PriceTrack collector.

## Security and privacy

- The import endpoint requires the existing private collector/admin authorization.
- Accept only `https://shopee.ph/` store pages and extracted Shopee product identities.
- Never accept arbitrary third-party URLs or executable content from the Shopee page.
- Validate browser messages by origin, source window, scan identifier, payload shape, and expiration.
- Treat the scan identifier only as message correlation; it is not a substitute for server authentication.
- Limit batch size, total products per scan, message frequency, scan duration, and stored URL length.
- Store no Shopee cookies, account data, customer data, browsing history, or unrelated page content.

## Failure handling

- If the extension is missing or outdated, show a clear update/install message and do not claim that scanning succeeded.
- If Shopee requires verification, pause and instruct the administrator to complete it in the store tab, then resume.
- If a scan stops early, retain successfully imported batches and label the result `Scan incomplete` with the collected totals.
- If the store tab closes, the admin page times out safely and can retry without duplicates.
- If a queue lease expires or collection stops, release it for a later run.
- If a queued product becomes unavailable, process it through the existing unavailable/sold-out recording and scheduling rules.
- A successful record remains the source of truth and completes the queue request even during a race with a collector claim.

## Extension delivery

Store-page scanning requires a new PriceTrack PH extension version. The website may be deployed first, but the scan button must remain disabled or show `Extension update required` until the compatible extension handshake succeeds. Existing price recording continues to work for older extension versions.

## Testing and production verification

Tests must cover:

- Valid Shopee store URLs begin an authorized scan; product URLs and unrelated domains are rejected.
- Scanner deduplicates repeated product cards and handles lazy-loaded results.
- Import batches classify new, already queued, and already tracked products accurately.
- Repeated scans are idempotent and discover newly listed products.
- A successfully or partially scanned store is saved once and remains available after page and browser restarts.
- Pasting an already saved store updates the same saved-store record instead of creating a duplicate.
- `Recheck` starts a new scan without requiring the URL to be pasted again.
- Recheck updates last-scan status, date, and totals while preserving the store's original first-added date.
- Toggle defaults on, persists appropriately, and reaches the server claim request directly.
- Claim order is priority, then store, then normal; disabling the toggle skips only store claims.
- Store products obey the existing 50-success run limit and one-hour cooldown.
- Concurrent collectors cannot lease the same store request.
- Successful recording completes the corresponding store request.
- Interrupted and expired leases become eligible again.
- Invalid browser messages, stale scan identifiers, oversized batches, and unauthorized API requests are rejected.
- Existing public priority, random collection, daily deduplication, sold-out, same-price, history, run-limit, and cooldown tests remain green.

Production verification must use a small controlled store scan first, confirm deduplication and ordering, then test the Jabra store URL. Report discovered/new/already-tracked totals rather than assuming Shopee's displayed product count is fully collectible.
