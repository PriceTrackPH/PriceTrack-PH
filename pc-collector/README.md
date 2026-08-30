# PriceTrack PH PC Collector

This Windows runner checks existing Shopee products through your normal home internet connection. It opens one product at a time in a dedicated visible Chromium window, reuses the proven PriceTrack PH extension extractor, and sends observations through the private admin collector endpoint.

## First setup

1. Install the current Node.js LTS release if it is not already installed.
2. Double-click `Setup-PC-Collector.bat`.
3. When Notepad opens, replace `paste_your_existing_admin_token_here` with the same private token used at `/admin/health`, then save and close Notepad.
4. Double-click `Test-5-Products.bat`.
5. Keep both the command window and the opened Chromium window visible until the test finishes.

After a successful five-product test, use `Check-All-Due-Products.bat` to process every product currently due for checking.

## Safety and behavior

- Only existing active Shopee products whose `next_check_at` is due are opened.
- Products successfully checked today are not selected again until their next 24-hour check.
- Unchanged prices update the lightweight daily-check record but do not create duplicate price observations.
- Changed prices create new price-history observations.
- Products are processed one at a time.
- The Supabase secret key never leaves Vercel. The PC stores only your existing admin token in the ignored `.env.local` file.
- Closing the collector releases its current product lease. A failed product can be tried again on the next run.

## Files

- `Setup-PC-Collector.bat` — one-time dependency and Chromium setup.
- `Test-5-Products.bat` — safe first test.
- `Check-All-Due-Products.bat` — processes all due products.
- `.env.local` — local private configuration; never commit or share it.
