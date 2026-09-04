# PriceTrack PH Regular Chrome Collector

This helper uses your installed, normal Chrome browser and the published PriceTrack PH Chrome Web Store extension. It does not launch Playwright or Chrome for Testing.

## First setup

1. Install or update the PriceTrack PH extension from the Chrome Web Store and confirm version `1.0.3` or newer.
2. Run `Setup-PC-Collector.bat` once, then run `Test-5-Products.bat`.
3. Normal Chrome opens the local controller. Click **Start collection** once and keep the controller, Shopee tab, extension, and command window open.

After a product is recorded, the controller displays `3`, `2`, `1`, then opens the next product. It pauses after two consecutive timeouts and never bypasses Shopee verification. Do not run the full checker until the five-product test succeeds.

## Safety and behavior

- Only existing active Shopee products whose `next_check_at` is due are opened.
- Products are selected randomly by the database, not alphabetically or in shop/ID order.
- A product is excluded when its default item or every one of its variations is sold out.
- Products successfully checked today are not selected again until their next 24-hour check.
- The first unchanged price check on each Manila calendar day creates a daily price observation; later identical checks that day update only the lightweight daily-check record.
- Changed prices create new price-history observations.
- Products are processed one at a time in a dedicated tab in your normal Chrome browser.
- When the Web Store extension records directly, the controller detects the database update and continues automatically.
- The Supabase secret key never leaves Vercel. The PC stores only your existing admin token in the ignored `.env.local` file.
- Stopping the collector releases its current product lease. A failed product can be tried again later.

## Files

- `Setup-PC-Collector.bat` — one-time local setup.
- `Test-5-Products.bat` — safe first test.
- `Check-All-Due-Products.bat` — processes all due products.
- `.env.local` — local private configuration; never commit or share it.
