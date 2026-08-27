# PriceTrack PH — New Chat Handoff

Last updated: **August 27, 2026**  
Repository: **PriceTrackPH/PriceTrack-PH**  
Production: **https://pricetrackph.com**  
Chrome Web Store item: **ilabeaeblpcleaipmnppibbfhjknlmeo**

## Purpose of this file

This is the master continuity record for PriceTrack PH. Read it before making project changes in a new chat. Update it after every material feature, fix, release, infrastructure change, important decision, incident, or backlog change.

Do not treat old chat suggestions as current backlog until they are checked against this file and the latest GitHub code.

## User working rules

1. Preserve proven working behavior. Make narrowly scoped changes unless the user explicitly requests broader work.
2. Inspect existing code before editing. Prefer changing the existing implementation over adding duplicate systems.
3. Keep solutions future-proof for new products, variations, users, and later marketplaces.
4. Explain where changes go and what they affect.
5. Maintain this handoff, the completed list, and the backlog after material work.
6. Do not automatically agree with an idea if it creates a worse product, security risk, unnecessary storage, or avoidable Web Store review.
7. Keep responses and tool use concise unless detail is needed.
8. Never expose or commit secrets, passwords, tokens, private keys, browser sessions, or `.env` files.
9. Public branding is **PriceTrack PH**. Do not show “Beta” publicly. Use the supplied PriceTrack PH logo/icon.
10. Shopee Philippines is the only supported marketplace now. Lazada and TikTok Shop are future possibilities, not current claims.

## Current production status

- Website is live at `https://pricetrackph.com`.
- `https://www.pricetrackph.com` permanently redirects to the apex domain.
- `pricetrackph.vercel.app` remains available as a deployment alias/fallback.
- Vercel deploys GitHub `main` automatically.
- Chrome extension **v1.0.1** is publicly published and automatically updates existing users.
- New installations receive v1.0.1 immediately; existing Chrome installations update on Chrome's schedule.
- Supabase project is **Product Tracking** (`sgitojuhoaxxnujdikbd`).
- Private admin monitor is available at `/admin/health` and requires the server-side admin token.
- Google Search Console domain ownership is verified.
- The dynamic sitemap was processed successfully and Google discovered **576 pages** on August 27, 2026.
- Homepage live test passed and priority indexing was requested.
- Bing Webmaster Tools is not set up yet.

## Current architecture

```text
Shopee product page
  -> Chrome extension detects product + variations
  -> Supabase Edge Function record-price
  -> products / product_variations / price_observations
  -> React/Vite website reads public history
  -> Vercel APIs provide title lookup, product SEO, sitemap, contact, observations and admin health
```

### Main technology

- React 19 + TypeScript + Vite
- Recharts for price-history graphs
- Supabase Postgres + Edge Function
- Vercel hosting and server functions
- Chrome Manifest V3 extension
- GitHub repository as source of truth

### Database identity and history rules

- A Shopee product is identified by **shop ID + item/product ID**, not title alone.
- Variations have separate records and separate price-history series.
- One product visit may submit all detected variations.
- Switching between variations must not be reported as one variation's price change.
- Duplicate price observations are protected at database/API level.
- Ingest quota/rate-limit updates are atomic.
- Diagnostic events are sanitized and retained for 30 days.

## Important routes and services

- Homepage: `/`
- Privacy policy: `/privacy/`
- Product report: `/product/shopee/{shopId}/{productId}`
- Sitemap: `/sitemap.xml`
- Robots: `/robots.txt`
- Private health dashboard: `/admin/health`
- Product title fallback API: `/api/find-product-by-title`
- Shopee short-link resolver: `/api/resolve-shopee-link`
- Contact endpoint: `/api/send-contact`

## Required server configuration names

Values must never be written in this file.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (server only; never prefix with `VITE_`)
- `ADMIN_HEALTH_TOKEN` (server only; user-created private dashboard password)
- `RESEND_API_KEY` (server only)
- Supabase Edge Function uses its configured service-role/secret environment values.

## Completed project work

### Foundation and data model

- Created the public PriceTrack PH website and GitHub repository.
- Connected Supabase Postgres and Vercel.
- Created products, product variations, and price observations model.
- Implemented per-variation history, stock status, latest price, lows, highs, average, observation counts, and change counts.
- Added duplicate observation protection, atomic quotas, batched variation recording, retry/stale-state recovery, and popup status synchronization.
- Added public read-only history access while keeping private operational data protected.

### Website product experience

- Product lookup by Shopee link.
- Exact product-title fallback and case-insensitive title search.
- Shopee mobile/short/affiliate redirect resolution.
- Stable permanent product URLs based on shop ID and item ID.
- Product report with store name, image, product name, variation selector, stock status, recorded price status, and outbound Shopee/affiliate actions.
- Per-variation graph with 7D, 30D, 90D and ALL ranges and hover details.
- Last-checked label and transparent tracking language.
- Light and dark themes.
- Mobile/responsive improvements, including donation and contact modals.
- Clean product navigation URLs: visible `#result` is removed after loading.
- Variation dropdown scroll is contained and no longer moves the page at its boundaries.

### Chrome extension

- Manifest V3 extension created and branded PriceTrack PH.
- High-resolution/sharp icon set and website favicon added.
- Automatic Shopee product and variation detection at page start.
- Background price recording with popup progress and completion state.
- Optional completion notification/toast behavior.
- “View price history” opens the product report.
- User-configurable single-key shortcut added.
- Shortcut settings live inside the clickable version panel; no separate settings box/page and no on/off switch.
- A saved key means enabled; clearing the key means disabled.
- Shortcut works while the popup is open.
- Extension URLs and host permission use `https://pricetrackph.com`.
- v1.0.0 was the initial public release.
- v1.0.1 was published publicly on August 27, 2026 and updates users automatically.

### Public site, support and privacy

- Custom domain purchased and attached correctly.
- `www` redirects to the apex domain with a permanent redirect.
- Privacy policy published at `https://pricetrackph.com/privacy/`.
- Privacy-page internal buttons use the custom domain.
- Contact form sends through a server endpoint, supports attachments, includes send states, and saves a temporary draft.
- Donation interface and responsive/mobile behavior added.
- Affiliate links are clearly labeled; direct Shopee links remain available.

### Monitoring and security

- Private admin health dashboard implemented.
- Diagnostic table and 30-day cleanup implemented.
- Recorder logs sanitized success, failure, partial, duplicate-blocked, and unusual variation-count events.
- Public users cannot read diagnostic records.
- Admin and Supabase secret keys remain server-side.
- Production build verified after monitoring implementation.
- User confirmed the production Shopee stress test and monitoring review completed on August 27, 2026.

### SEO and indexing

- Shopee-focused homepage title and description.
- Canonical URLs, Open Graph, Twitter metadata, and structured data.
- Unique server-rendered title/description/canonical metadata for permanent product pages.
- Dynamic `sitemap.xml` generated from existing product IDs; it does not duplicate database records.
- `robots.txt` added.
- Google Search Console domain property verified using a Vercel DNS TXT record.
- Two owners are acceptable when both accounts belong to the user.
- Sitemap processed successfully with 576 discovered pages.
- Homepage is available to Google and indexing was requested.

## Important incidents and lessons

1. The repository root `index.html` was accidentally replaced with an unrelated Cashflow Hub page. It was restored in commit `5ec0771`. Always inspect the exact remote file and preserve newer legitimate changes before publishing.
2. Browser login and terminal Git authentication are separate. The connected GitHub repository tools can publish without asking the user to install local software.
3. The local worktree contains unrelated or unfinished changes and generated ZIP/screenshots. Never commit everything blindly. Publish only the intended files/hunks.
4. Chrome Web Store locks listing edits while an update is pending review. Do not cancel a harmless review unless necessary.
5. Browsers cache favicons; hard refresh/reopen may be needed after favicon deployment.
6. Google Search Console initially showed “Couldn't fetch” for the sitemap, but the endpoint returned valid XML/HTTP 200 and later processed successfully. Do not create duplicate sitemap submissions.
7. Search Console indexing requests do not guarantee immediate indexing or ranking.

## Current backlog — prioritized

### Next recommended

1. **Bing Webmaster Tools** — import `pricetrackph.com` from Google Search Console and submit the existing sitemap.
2. **Google indexing follow-up** — review Pages/Performance after Google has had time to crawl; do not repeatedly request the same URL.

### Research / later releases

3. **Shopee Affiliate/Open API investigation** — determine whether an official integration is available and worthwhile without weakening privacy or reliability.
4. **Extension v1.0.2 planning** — group meaningful improvements before another Web Store review. Possible listing/package name: `PriceTrack PH – Shopee Price Tracker`.
5. **Search improvement only if needed** — current exact case-insensitive title fallback works; consider fuzzy suggestions/results only after observing real failed searches.
6. **Responsive quality pass** — continue checking unusual screen sizes and long product/variation names.
7. **Lazada support** — only after Shopee behavior is stable and the data model/collector approach is proven.
8. **TikTok Shop investigation** — much later and only if technically and legally practical.

## Explicitly removed / not current backlog

- Do not add ratings and total-sold information unless the user asks again.
- Do not create a separate shortcut settings page or a shortcut on/off switch.
- Do not claim Lazada or TikTok Shop support before it exists.
- Do not replace product identity with product-title matching.
- Do not disable the old Vercel alias while it may still help as a fallback.

## Release and verification checklist

For website changes:

1. Inspect existing code and dirty worktree.
2. Change only intended files/hunks.
3. Run `npm run build`.
4. Review the diff for unrelated changes and secrets.
5. Publish to GitHub `main` only when the user requested publishing or the requested implementation clearly includes it.
6. Confirm Vercel deployment is `READY`.
7. Verify the live behavior and relevant raw response when SEO/routing is involved.
8. Update this handoff and backlog.

For extension changes:

1. Test unpacked locally first when possible.
2. Preserve working recording behavior.
3. Increment the manifest version for every new Web Store package.
4. Create a clean ZIP containing only extension files.
5. Verify requested permissions and host permissions.
6. Let the user upload/submit when they want to manage the Web Store manually.
7. Update this handoff after approval/publication.

For database/backend changes:

1. Read current schema/function first.
2. Use migrations for schema changes.
3. Preserve RLS and public/private boundaries.
4. Store no unnecessary full URLs or personal information in diagnostics.
5. Test duplicates, partial failures, quotas, and variation identity.
6. Update this handoff.

## How to update this file every time

After material work, update all applicable sections:

- Change `Last updated`.
- Move finished work from backlog to Completed.
- Add new decisions and user constraints.
- Record release/version/deployment status.
- Record important incidents and their fixes.
- Remove stale backlog items after checking the current code.
- Keep secrets and personal credentials out.
- Commit this file with the related change when practical, or in a dedicated documentation commit.
