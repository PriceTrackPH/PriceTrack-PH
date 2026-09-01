# PriceTrack PH — Project History and Feature Record

Last updated: **August 30, 2026**  
Project started: **August 21, 2026**  
Production website: **https://pricetrackph.com**  
Repository: **PriceTrackPH/PriceTrack-PH**  
Current marketplace: **Shopee Philippines**

## Purpose

This document is the permanent history of PriceTrack PH from its first commit onward. It records major features, architecture decisions, releases, fixes, incidents, and intentionally removed behavior.

Use this file to understand how the product evolved. Use `NEW_CHAT_HANDOFF.md` for the latest operating instructions, active status, and immediate backlog.

## Product vision

PriceTrack PH is an independent public price-history service for Philippine online marketplaces. Its first supported marketplace is Shopee Philippines.

The product is designed to:

- Let visitors paste a Shopee product link and find an existing price report.
- Resolve normal, mobile, short, and affiliate Shopee links into a stable product identity.
- Record product and variation prices through the PriceTrack PH Chrome extension.
- Keep a separate price history for every variation.
- Show transparent public price information without requiring an account.
- Avoid treating a switch between variations as a price change.
- Expand to other marketplaces only after the Shopee system is stable.

## Core principles

1. A product is identified by **marketplace + shop ID + item/product ID**, never by title alone.
2. Every real Shopee variation has its own identity, current state, and price history.
3. Unchanged prices do not create duplicate observations.
4. Public users receive read-only access to price-history data.
5. Operational data, admin functions, secrets, and diagnostic records remain private.
6. PriceTrack PH does not bypass Shopee verification or CAPTCHA.
7. New functionality must preserve working collection and historical data.
8. Shopee Philippines is the only currently supported marketplace.

## Current architecture

```text
Shopee product page
  -> PriceTrack PH Chrome extension
  -> Supabase record-price Edge Function
  -> products
  -> product_variations
  -> price_observations
  -> React/Vite public website
  -> permanent product report
```

Additional systems:

```text
Shopee pasted link
  -> Vercel short-link resolver
  -> stable shop ID + item ID
  -> existing public product report

Regular Windows Chrome collector
  -> protected Vercel bridge
  -> due-product claim
  -> dedicated Shopee tab
  -> extension observation
  -> protected record/release action
```

## Main technology

- React 19, TypeScript, and Vite
- Recharts for interactive price-history graphs
- Supabase Postgres and Edge Functions
- Vercel hosting and server functions
- Chrome Manifest V3 extension
- Normal Chrome Windows PC collector
- GitHub `main` as the application source of truth
- Google Apps Script bridge for optional affiliate-file archiving

## Database model

### `products`

Stores the marketplace product identity and product-level metadata, including Shopee shop ID, item ID, title, seller/store details, image, source URL, tracking state, and affiliate metadata when available.

### `product_variations`

Stores one row for each Shopee model or variation. Variations are not collapsed into one product-level price.

### `price_observations`

Stores historical price and stock observations for a specific variation. Duplicate protection prevents repeated identical records from unnecessarily growing the database.

### `ingest_rate_limits`

Stores private ingestion quota and rate-limit state. Public access is denied.

### `diagnostic_events`

Stores sanitized operational events for the private health dashboard. Records are retained for 30 days.

### `product_daily_checks`

Stores daily-check state, due time, lease state, and successful-check completion for the PC collector workflow.

## Permanent public routes

- `/` — public homepage and product lookup
- `/privacy/` — public extension and website privacy policy
- `/product/shopee/{shopId}/{productId}` — permanent product report
- `/sitemap.xml` — dynamic product sitemap
- `/robots.txt` — crawler instructions

## Private routes and APIs

- `/admin/health` — recording health and recent diagnostic events
- `/admin/affiliate` — Shopee affiliate batch tools
- `/api/resolve-shopee-link` — Shopee mobile, short, and affiliate-link resolver
- `/api/find-product-by-title` — exact title fallback lookup
- `/api/product-page` — product-specific SEO renderer
- `/api/sitemap` — dynamic sitemap generator
- `/api/send-contact` — contact form delivery
- `/api/admin-affiliate-links` — protected affiliate import/export workflow
- `/api/admin-pc-collector` — protected PC collector bridge

## Feature history by day

### Day 1 — August 21, 2026: Foundation

- Created the PriceTrack PH repository and initial website.
- Established the public marketplace price-history concept.
- Built the first responsive website structure and initial branded interface.
- Introduced product reporting, price statistics, and price-history presentation.
- Started the browser-extension experience and early extension interface work.
- Established light and dark presentation foundations.
- Began extensive responsive and visual refinement for the homepage, report cards, graphs, and extension preview.

### Day 2 — August 22, 2026: Variation-first reports and extension maturity

- Made Shopee product variations a first-class part of the report.
- Added a branded variation selector and refined its sizing, scrolling, click behavior, and long-label handling.
- Hid the selector for products with only one real model.
- Prevented a legacy default variation from appearing when real Shopee models exist.
- Added clear out-of-stock styling for individual variations.
- Refined product image, store information, product title, statistics, graph spacing, axis labels, and chart points.
- Added 7D, 30D, 90D, and ALL price-history ranges.
- Added daily-low presentation with intraday details where available.
- Added completion feedback after all detected variations finish recording.
- Tested in-page completion notices and system notifications, then simplified notification behavior.
- Added an optional extension notification setting with a safe default.
- Improved automatic variation detection and preserved the stable implementation after a speed experiment was reverted.
- Refined the light/dark theme control and marketplace-neutral public copy.

### Day 3 — August 23, 2026: PriceTrack PH branding and public support

- Completed the transition to the public **PriceTrack PH** name.
- Renamed the package and repository documentation.
- Consolidated the source into the main branch.
- Added and styled donation options and QR assets for GCash, Maya, and bank/QR Ph support.
- Continued theme, header, report, and responsive refinements.

### Day 4 — August 24, 2026: Production hardening

- Prepared the application and extension for the production Vercel domain.
- Updated extension host permissions and report URLs.
- Added informational footer popups and clearer marketplace-support language.
- Built the contact experience, including temporary draft saving, direct email delivery, server send states, and mobile layout improvements.
- Added the product-report affiliate-link action while retaining a direct Shopee action.
- Fixed an affiliate-button observer that could freeze product pages.
- Added database-level duplicate protection for price observations.
- Improved extension stale-state recovery and status synchronization.
- Added support for slow Shopee page reloads.
- Batched variation recording so large variation sets finish faster.
- Hardened ingestion and made rate-limit accounting atomic.
- Added the product “Last checked” label.

### Day 5 — August 25, 2026: Mobile pasted-link support and public extension release

- Added the Shopee short-link resolver API.
- Added support for links copied from the Shopee mobile app.
- Hardened affiliate short-link parsing and affiliate redirect-wrapper handling.
- Improved mobile lookup success behavior.
- Added exact, case-insensitive product-title fallback search without replacing the normal link workflow.
- Prepared the extension for public release with polished branding and icon assets.
- Set extension version **1.0.0** as the initial Chrome Web Store release.
- Restored proven automatic recording behavior and its observation endpoint.
- Added extension version display.
- Published the public privacy policy.
- Connected footer and navigation privacy controls.
- Added secure contact-form attachments and improved mobile contact layout.

### Day 6 — August 26, 2026: Monitoring, recovery, and extension shortcuts

- Added the private health-monitoring dashboard.
- Added operational counters and sanitized recent-event reporting.
- Recovered the PriceTrack PH website after the repository root page was accidentally replaced by an unrelated page.
- Improved exact product-title handling and extension report loading from permanent product URLs.
- Added a user-configurable single-key extension shortcut.
- Explored a separate shortcut settings view, then consolidated the control into the extension popup.
- Made clearing the saved key equivalent to disabling the shortcut, avoiding a redundant on/off setting.

### Day 7 — August 27, 2026: Permanent URLs, SEO, indexing, and cleanup

- Moved shortcut configuration into the clickable extension version panel.
- Ensured shortcuts work while the extension popup is open.
- Added permanent product routes using Shopee shop ID and item ID.
- Added server-rendered product-specific metadata.
- Added canonical, Open Graph, Twitter, and structured metadata.
- Added a dynamic product sitemap and crawler rules.
- Routed product reports through the SEO renderer.
- Removed the visible `#result` anchor after navigation.
- Contained variation-dropdown scrolling so it does not move the whole page.
- Created the master `NEW_CHAT_HANDOFF.md` continuity document.
- Connected public extension actions to the Chrome Web Store.
- Simplified redundant homepage sections.
- Removed the donation section temporarily; it was restored later at the owner’s request.
- Published extension **v1.0.1**.
- Completed the production stress test and monitoring review.
- Verified the site in Google Search Console and submitted the dynamic sitemap.

### Day 8 — August 28, 2026: Affiliate operations and Google Drive archiving

- Added a protected Shopee Affiliate batch export/import system.
- Added database types and a secured service-role-only import function.
- Added private admin controls and status counts.
- Used Shopee’s official batch workbook format.
- Exported only products that lacked affiliate links.
- Automatically populated `Sub_id1` with `PriceTrackPH`.
- Imported Shopee’s returned CSV by matching original and converted URLs through shop ID + item ID.
- Prevented existing affiliate URLs from being overwritten.
- Counted invalid, failed, unmatched, and successful rows separately.
- Fixed public affiliate and direct Shopee report buttons.
- Fixed metadata merging so later price recordings no longer erase affiliate URLs.
- Added Google Drive archive support for successful import/export files through an Apps Script bridge.
- Added archive setup documentation and admin backup-status display.
- Completed Chrome Web Store developer identity verification.
- Imported the site into Bing Webmaster Tools and submitted its sitemap.

### Day 9 — August 29, 2026: Admin separation, resolver fixes, and chart accuracy

- Updated the resolver for newer Shopee affiliate short-link formats.
- Added support for `shopeeph://reactPath` wrappers and canonical product destinations.
- Split private administration into `/admin/health` and `/admin/affiliate`.
- Redirected the removed `/admin/monitoring` route to Health.
- Added a dedicated admin login route and reusable authenticated session behavior.
- Kept public and admin navigation separate, including responsive mobile navigation.
- Restored the complete public homepage sections after an accidental source regression.
- Restored recording status and event panels.
- Applied consistent theme-aware admin styling.
- Improved chart range transitions and prevented reversed animations.
- Made chart date ranges use exact Philippine calendar days.

### Day 10 — August 30, 2026: Daily checks and the normal-Chrome PC collector

- Added the daily product-check ledger and due-product queue.
- Added change-only cross-day deduplication while still marking a successful daily check.
- Built a protected server-side collector prototype.
- Confirmed that direct Supabase/datacenter collection was blocked by Shopee with HTTP 403/error `90309999`.
- Kept cloud Cron disabled after the failed server-side test.
- Added a residential PC collector using the owner’s Philippine home connection.
- Replaced automated Chrome-for-Testing navigation with the user’s installed normal Chrome.
- Added a local controller at `127.0.0.1:47321`.
- Reused one dedicated Shopee tab and connected extension observations to the protected backend bridge.
- Fixed the Windows regular-browser launcher.
- Added safe Start and Stop controls.
- Added five-product test and all-due-products launchers.
- Added progress counts for completed, processing, remaining, succeeded, and failed work.
- Added full database totals and Done/Total and Left/Total presentation.
- Added sold-out handling with deferred weekly rechecking instead of permanent skipping.
- Added a warning that Shopee verification may appear during larger batches and must be completed manually.
- Preserved the rule that the collector never bypasses verification or CAPTCHA.
- Added the first installable PriceTrack PH Progressive Web App release.
- Added Android Share Target support so links shared from Shopee can open PriceTrack PH with the product URL detected automatically.
- Added standalone app presentation, 192px and 512px install icons, service-worker registration, and a lightweight offline fallback.
- Kept phone-app lookup behavior aligned with the public website: recorded products show their reports, while first-time price collection still requires a trusted extension or PC collector observation.
- Corrected the first phone-share result state so an untracked product shows only accurate PC-recording guidance, without a false zero-change success message or empty report card.
- Added the first advertising foundation: one responsive report ad, a global protected admin ON/OFF control, a locked-down Supabase setting that defaults OFF, and conditional script loading so disabled ads do not load Google advertising code.
- Connected the site to its AdSense publisher account using Google’s ownership meta tag, keeping verification separate from actual ad loading.

## Current website features

### Product lookup

- Accepts known direct Shopee product links.
- Resolves supported Shopee mobile, short, affiliate, and redirect-wrapper links.
- Uses stable shop and item IDs for report routing.
- Supports exact case-insensitive title fallback for products already in the database.
- Displays a clear untracked state when a report does not yet exist.
- Can be installed as a standalone web app on supported Android devices.
- Can receive shared text or URLs through the Android Share menu and extract the included Shopee link.

### Product report

- Product image, title, seller/store name, and Shopee identity
- Variation selector with long-name and scroll handling
- Current listed price and stock status per variation
- Lowest, highest, average, observation, and change information
- Interactive graph with 7D, 30D, 90D, and ALL ranges
- Hover details and Philippine calendar-day range behavior
- Last-checked information
- Clearly labeled affiliate and direct Shopee actions
- Permanent, shareable, crawlable product URL

### Chrome extension

- Automatic product detection on supported Shopee product pages
- Automatic recording of all detected variations
- Background recording and progress feedback
- Completion state and optional notification behavior
- Direct opening of the PriceTrack PH product report
- User-configurable single-key shortcut
- Version 1.0.3 opens the exact Shopee variation selected by the user when launching its price-history report.
- Public version v1.0.1; local collector testing may use newer unpacked code

### Private administration

- Authenticated health dashboard
- Recording status and 30-day operational summaries
- Sanitized recent events
- Affiliate missing-count summary
- Official affiliate batch export and CSV import
- Optional Google Drive archive status
- Separate public and private navigation

### PC collector

- Uses normal installed Chrome rather than a separate test browser
- Claims only due, active, tracking-enabled products
- Uses a temporary lease so abandoned work can be released
- Records through the installed unpacked extension and protected bridge
- Reuses one dedicated Shopee tab
- Supports a five-product test and all-due run
- Shows database-wide and current-run progress
- Defers sold-out products to a weekly schedule
- Stops safely and waits for manual verification when necessary

## SEO and discovery

- Custom production domain with permanent `www` redirect
- Canonical URLs
- Product-specific server-rendered metadata
- Open Graph and Twitter metadata
- Structured data
- Dynamic product sitemap generated from product identities
- `robots.txt`
- Google Search Console verification and sitemap processing
- Bing Webmaster Tools import and sitemap submission

## Security and privacy decisions

- Service-role and admin credentials remain server-side.
- The browser extension never contains the private admin token.
- `.env.local` and browser-session data must never be committed.
- Public users cannot read diagnostics or private rate-limit state.
- Affiliate importing is restricted to protected server-side execution.
- Diagnostics are sanitized and retained only for their intended operational period.
- Shopee verification is handled manually; no bypass is implemented.

## Important incidents

### Accidental website replacement

The repository root page was accidentally replaced with an unrelated Cashflow Hub page. The site was restored on August 26, 2026. Future work must inspect exact files and stage only intended changes.

### Affiliate metadata loss

Price recording once replaced product metadata and erased imported affiliate URLs. Recording was changed to merge existing metadata, and affected links were restored.

### Cloud collection blocked

Shopee rejected server/datacenter collection with HTTP 403/error `90309999`. Automatic cloud Cron remains disabled. Normal Chrome through the owner’s home connection became the approved test approach.

### Broken Windows launcher

The first normal-Chrome collector package attempted to open an invalid Windows path. The launcher was changed to use the correct Windows browser-opening behavior.

### Sitemap delay

Google Search Console initially reported that it could not fetch the sitemap even though the endpoint returned valid XML and HTTP 200. It later processed successfully, confirming that duplicate resubmission was unnecessary.

## Removed or superseded behavior

- Public “Beta” branding was removed.
- A separate shortcut settings page was removed; settings now live in the extension popup.
- A shortcut on/off switch was avoided; clearing the key disables it.
- Chrome system notification permission was removed after simpler feedback proved preferable.
- The donation section was removed temporarily and later restored.
- `/admin/monitoring` was replaced by separate Health and Affiliate pages.
- Automated Playwright/Chrome-for-Testing collection was replaced by normal Chrome.
- Direct cloud price collection and Cron remain disabled because Shopee blocked the server request.

## Known limitations

- Only Shopee Philippines is supported.
- A pasted product link can resolve to a stable report only when the supported URL ultimately identifies a public Shopee product.
- New price history depends on successful observations from the extension or PC collector.
- Verification frequency is controlled by Shopee and cannot be guaranteed.
- The PC collector must remain running for unattended due-product processing.
- PriceTrack PH does not promise instant coverage of every Shopee product.
- Search is intentionally exact-first; fuzzy search is not currently part of the proven system.

## Backlog

### Near term

- Monitor Google and Bing indexing and search performance.
- Group meaningful changes before submitting another Chrome Web Store release.
- Continue responsive testing for unusual screens and long variation names.
- Continue cautious five-product collector testing before large runs.

### Later research

- Approved Shopee Open API access, if it offers useful public product information.
- Compliant external browser infrastructure only if operating cost is justified.
- Lazada support after the Shopee system is stable.
- TikTok Shop support only if technically and legally practical.
- Fuzzy title suggestions only if real lookup failures justify the added complexity.

## Release rules

### Website

1. Inspect existing code before editing.
2. Preserve unrelated work.
3. Build successfully with `npm run build`.
4. Review the exact diff for secrets and unintended changes.
5. Publish only when authorized.
6. Confirm the Vercel production deployment is ready.
7. Verify the affected live route.

### Extension

1. Test unpacked code first.
2. Preserve automatic product and variation recording.
3. Increment the manifest version for every Web Store update.
4. Package only extension files.
5. Recheck permissions and host permissions.

### Database and backend

1. Inspect the current schema and function before editing.
2. Use migrations for schema changes.
3. Preserve RLS and public/private boundaries.
4. Test duplicate, partial-failure, quota, lease, and variation-identity behavior.
5. Never place secrets in frontend code or documentation.

## Maintaining this history

Update this document after each meaningful release, major feature, architecture decision, incident, or removal. Add concise milestones instead of listing every styling commit. Keep the following accurate:

- Last-updated date
- Public release versions
- Current supported marketplaces
- Architecture and database behavior
- Completed features
- Important incidents and lessons
- Removed or superseded behavior
- Known limitations and backlog

Never add passwords, secret keys, private tokens, browser sessions, or private user data.
