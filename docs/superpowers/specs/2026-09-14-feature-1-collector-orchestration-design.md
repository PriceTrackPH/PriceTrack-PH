# Feature 1 Collector Orchestration Design

## Goal

Make PriceTrack PH collection faster, correctly prioritized, recoverable after transient failures, and observable across multiple collector browsers without changing normal extension recording behavior.

## Queue policy

- Drain all due Priority requests before other work.
- Then repeat one due Store request followed by two due Normal products.
- Claims remain lease-protected so simultaneous browsers cannot process the same work.
- Within a queue, order by the best trustworthy activity data available: exact estimated daily sales; Shopee sales activity fallback; exact Shopee views; unique daily PriceTrack product opens; recent changed-price recordings; recent price drop; current discount; total sold; reviews; favorites; rating confidence; low activity; no activity.
- Missing metrics are unknown, not zero. Unavailable/error products are scheduled separately and do not block healthy products.

## Product-open metric

- Count one normal extension visit per product, installation, and Asia/Manila calendar day.
- Multiple variations or repeated opens on the same day do not add visits.
- Different installations add separate visits.
- Admin Collector and Store Scanner visits never add product opens.

## Collection controls

- Normal mode stops after 50 successful products and starts the existing one-hour cooldown.
- Unlimited mode has no 50-product cap and no post-product one-second delay.
- Stop prevents new navigation but allows the active extension recording to reach database acknowledgement, counts that product, releases its claim, and saves `stopped_safely`.
- Collector buttons alone use the approved purple active/disabled palette; exact hex values must be sampled and asserted before release.

## Unavailable and error scheduling

- Sold Out, Unlisted, and Doesn't Exist are terminal results for the current attempt: advance immediately.
- Their first confirmed result schedules 15 days; a repeated unavailable result schedules 30 days, continuing every 30 days until recovery.
- A first Page Error is retried once at the end of the current run. A second consecutive Page Error schedules 15 days, then 30-day intervals while it persists.
- A successful available result resets unavailable/error counters.

## Fast collection and verification

- Admin collection consumes Shopee product data as soon as the extension can safely extract it and advances only after database acknowledgement.
- Unnecessary page assets must not be required for correctness. Existing extraction remains the fallback.
- Detect Shopee verification/CAPTCHA, pause collection, play one notification sound per verification event, show a clear instruction, and resume automatically after verification clears.

## Failure recovery and history

- Retry transient Collector API/network/5xx failures with bounded backoff.
- An acknowledged product remains counted if a later API call fails.
- Finalization retries independently. If it cannot complete immediately, retain a pending-finalization checkpoint rather than converting the run to `interrupted`.
- `Interrupted` is reserved for genuinely abandoned sessions.
- Collector history, Health recent events, and Store Scan History show the newest 20 rows in a scrollable viewport and remove data older than 31 days.
- History totals include Priority, Store, Normal, Sold Out, Same Price, Failed, and Remaining without double counting.

## Live multi-browser state

- Each Collector page controls only its own run.
- Supabase Realtime broadcasts history changes; other open pages refresh history without two-second polling.
- A remote run completion/stoppage displays a temporary five-second message and does not replace the local run status.

## Store Scanner page

- Clear the store URL only after a completed scan; keep it after incomplete/interrupted scans.
- Remove the Current page card.
- Keep Pages scanned and the textual `Scanning page X of Y` progress.

## Compatibility and release

- Preserve popup, variation extraction, price history, extension notifications, Store Scanner discovery, and public browsing behavior.
- Ship the database migration before code that depends on it, then push the verified commit to `main` and verify the Vercel production deployment.
