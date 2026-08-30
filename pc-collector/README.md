# PriceTrack PH Regular Chrome Collector

This helper uses your installed, normal Chrome browser and the unpacked PriceTrack PH extension. It does not launch Playwright or Chrome for Testing.

## First setup

1. Open `chrome://extensions` in normal Chrome and enable **Developer mode**.
2. Remove the older unpacked PriceTrack PH extension if it points to another folder.
3. Click **Load unpacked**, select the updated `extension` folder beside `pc-collector`, and confirm version `1.0.2`.
4. Run `Setup-PC-Collector.bat` once, then run `Test-5-Products.bat`.
5. Normal Chrome opens the local controller. Click **Start collection** once and keep the controller, Shopee tab, extension, and command window open.

The controller waits at least 60 seconds between products and pauses after two consecutive timeouts. It never bypasses Shopee verification. Do not run the full checker until the five-product test succeeds.

## Safety and behavior

- Only existing active Shopee products whose `next_check_at` is due are opened.
- Products successfully checked today are not selected again until their next 24-hour check.
- Unchanged prices update the lightweight daily-check record but do not create duplicate price observations.
- Changed prices create new price-history observations.
- Products are processed one at a time in a dedicated tab in your normal Chrome browser.
- The Supabase secret key never leaves Vercel. The PC stores only your existing admin token in the ignored `.env.local` file.
- Stopping the collector releases its current product lease. A failed product can be tried again later.

## Files

- `Setup-PC-Collector.bat` — one-time local setup.
- `Test-5-Products.bat` — safe first test.
- `Check-All-Due-Products.bat` — processes all due products.
- `.env.local` — local private configuration; never commit or share it.
