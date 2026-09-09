# Design Q — Shopee Store Scanner Page

Date: September 9, 2026

## Goal

Move the existing Shopee store-import interface out of `/admin/collector` and into a dedicated private **Store Scanner** page. Make store discovery, sold-out discovery, scan progress, saved-store rechecks, and scan history understandable without changing unrelated PriceTrack PH behavior or styling.

## Strict scope

Design Q changes only:

- The location and presentation of the existing Shopee store importer.
- Multi-page completion detection for Shopee store scans.
- Sold-out product discovery, counting, persistence, and `See More` expansion.
- Store scan history and saved-store recheck controls.
- Automatic closing of the dedicated Shopee scanner tab after a verified successful scan.

Design Q must not change the public site, product reports, normal Collector history, collector limits, cooldowns, queue order, price-recording validation, existing color palette, or unrelated text and layout.

## Navigation and page location

- Remove the store-import panel from `/admin/collector`.
- Add a dedicated private Store Scanner page.
- Add a **Store Scanner** navigation link beside the existing **Collector** link.
- Preserve the existing header, theme switcher, typography, colors, spacing system, and private-admin access rules.
- Keep the normal Collector page and its **Collection history** unchanged.

## Store Scanner controls

The page contains:

- Heading: **Shopee Store Scanner**
- Description: **Discover every regular and sold-out product from a Shopee store and add new products to PriceTrack PH.**
- Input placeholder: **Paste a Shopee Philippines store link**
- Primary button: **Scan store**
- Secondary button: **Recheck all stores**

`Recheck all stores` processes saved stores sequentially, one store at a time. It must not open or scan several Shopee stores simultaneously.

## Live scan summary

Display compact summary boxes for:

- **Found** — the total number of unique products discovered, including regular and sold-out products.
- **New queued** — newly discovered regular products added to the store queue.
- **Already queued** — products already waiting in the store queue.
- **Already tracked** — products already present in the PriceTrack PH product database.
- **Sold Out** — unique sold-out products detected during the scan.
- **Pages scanned** — current and total regular-product pages, such as `3/4` or `4/4`.
- **Current page** — the page currently being processed.

The live status message may show only these scan-specific states:

- **Scanning page X of Y…**
- **Loading more sold-out products…**
- **Saving discovered products…**
- **Scan completed**
- **Scan incomplete — Shopee verification required**
- A concise scan error when completion cannot be verified.

## Regular-product pagination

For each regular-product page, the scanner must:

1. Wait for the store product grid to load and stabilize.
2. Discover every unique regular-product identity visible on that page.
3. Save product batches idempotently.
4. Read the current and maximum page values when Shopee exposes a counter such as `3/3`.
5. Continue with the Next control while the current page is below the maximum and Next is enabled.

The scanner considers regular-product pagination finished when either:

- The current page equals the maximum page, such as `3/3`, `4/4`, or `20/20`; or
- The Next control is unavailable or verifiably disabled.

The scanner must not declare completion merely because clicking Next did not immediately change the page.

## Sold-out discovery and `See More`

After reaching the final regular-product page, the scanner must:

1. Locate the store's Sold Out section when present.
2. Discover and deduplicate all currently visible sold-out product identities.
3. Click the Sold Out section's **See More** control when it is enabled.
4. Wait until additional product cards finish loading.
5. Discover only newly revealed identities while preserving the complete unique total.
6. Repeat until **See More** disappears or becomes disabled.

The scanner must distinguish the Sold Out section's **See More** from unrelated buttons or links elsewhere on the Shopee page.

Sold-out products count toward **Found** and also toward the separate **Sold Out** total. For example, 300 regular products plus 20 sold-out products produces **Found: 320** and **Sold Out: 20**.

## Sold-out persistence and later collection

- A sold-out product discovered during a store scan is saved directly with sold-out status instead of being added as a regular pending store-queue item.
- Its first normal eligibility date is deferred by 15 days using the existing sold-out scheduling rules.
- After 15 days, it becomes eligible for the normal Collector.
- If it remains sold out when verified, the existing escalating sold-out recheck schedule applies.
- If it becomes available, it returns to the normal collection cycle.
- Repeated store scans must update the existing product identity rather than create duplicate product or queue records.

## Successful completion and tab handling

A scan is **Completed** only after:

- All regular-product pages were processed.
- The final regular page was verified using its page maximum or disabled/unavailable Next control.
- The Sold Out section was processed.
- Sold Out **See More** was exhausted when present.
- Every discovered batch was acknowledged as saved.

After those conditions succeed, mark the scan **Completed** and automatically close only the dedicated Shopee store-scanner tab.

If verification appears, navigation is uncertain, saving fails, the scanner tab closes early, or the scanner cannot prove completion, mark the scan **Incomplete** or **Interrupted** and keep the Shopee scanner tab open whenever it still exists.

## Store Scan History

The history section heading must be exactly **Store Scan History**.

Columns:

- **Scan time** — scan start date and time.
- **Store** — store name that opens its Shopee store when clicked.
- **Running time** — total scan duration.
- **Found** — all unique regular and sold-out products discovered.
- **New queued** — newly queued regular products.
- **Already queued** — existing store-queue products encountered.
- **Sold Out** — unique sold-out products discovered.
- **Pages** — completed pagination progress, such as `4/4`.
- **Tracked** — already tracked products encountered.
- **Status** — Completed, Incomplete, or Interrupted.
- **Action** — a **Recheck** button.

The clickable Store value must look exactly like the surrounding plain table text. Do not add link-blue coloring, an underline, or any other visual treatment. Its cursor and activation behavior may identify it as interactive without changing its displayed text style.

The history area also includes:

- Store-name search.
- Status filter: All, Completed, Incomplete, or Interrupted.
- Pagination with 20 rows per page.

The history table replaces the long standalone Saved stores list on the new Store Scanner page. Each saved store remains recheckable from its history row.

## Counting rules

- Deduplicate by stable Shopee shop ID and item ID.
- **Found = unique regular products + unique sold-out products**.
- A product appearing more than once in one scan contributes one to Found.
- A sold-out product contributes one to Found and one to Sold Out.
- Already queued and already tracked classifications must be mutually exclusive for the displayed scan result.
- A store scan recheck creates a new history record while retaining the saved store identity.

## Error handling

- Missing or outdated extension: show an extension update message and do not start a false scan.
- Shopee verification: pause on the same page until resolved; do not skip the page or declare success.
- Unreadable page maximum with an enabled Next control: continue cautiously; do not complete early.
- Failed page transition: mark Incomplete and keep the tab open.
- Failed Sold Out expansion: mark Incomplete and keep the tab open.
- Failed batch persistence: retry safely without duplicates, then mark Incomplete if saving cannot finish.
- Closing or refreshing the admin page must not convert an unfinished scan into Completed.

## Testing and acceptance criteria

Tests must verify:

- The importer is available only on the dedicated Store Scanner page and is absent from the Collector page.
- Navigation exposes Store Scanner without changing unrelated navigation styling or text.
- Found includes unique regular and sold-out products.
- Sold Out reports only unique sold-out products.
- Pagination continues until the current page reaches the maximum or Next is verifiably disabled.
- Final-page product cards are saved before completion.
- Sold Out **See More** is repeatedly expanded until exhausted.
- Unrelated **See More** controls are never clicked.
- Sold-out products are saved with a 15-day first recheck and later enter normal collection.
- Repeated scans do not duplicate products or active queue records.
- Recheck all stores runs sequentially.
- Successful scans close only the dedicated Shopee scanner tab.
- Incomplete, interrupted, verification-blocked, or failed scans do not close an existing scanner tab.
- Store Scan History uses the exact approved heading and columns.
- Store names are clickable without link coloring or underlining.
- Existing Collector behavior, Collector history, public pages, and unrelated styles remain unchanged.
