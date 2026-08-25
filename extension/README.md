# PriceTrack PH Chrome Extension

Current public release candidate: **v1.0.1**.

This extension runs on Shopee Philippines product pages, detects Shopee model/variation data as early as possible, and sends public product price observations to the PriceTrack PH website API.

## Public installation

Install **PriceTrack PH** from its official Chrome Web Store listing. The PriceTrack PH website links to that listing through the `VITE_CHROME_WEB_STORE_URL` deployment environment variable.

## Local development installation

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this `extension` folder.
5. Open a Shopee Philippines product page and click the PriceTrack PH extension icon to view detection/recording status.

## v1.0.1 behavior

- Starts variation detection at `document_start` instead of waiting for the full Shopee page load.
- Captures Shopee product API responses through the page bridge and also uses bounded fallback requests.
- Detects all available Shopee models/variations without requiring the user to click each option.
- Records variation price, original price when available, and in-stock/out-of-stock state.
- Shows detection in the popup before the database save finishes.
- Prevents duplicate extraction runs when the popup is opened immediately after an automatic run.
- Uses a visible-price fallback only when Shopee model data cannot be found.

## Files

- `manifest.json` — Manifest V3 configuration and permissions.
- `shopee-bridge.js` — page-world bridge that observes Shopee product API responses.
- `content.js` — product extraction, variation normalization, popup status storage, and observation submission.
- `popup.html` / `popup.css` / `popup.js` — extension popup UI and live status updates.

## Security

The extension does not contain a Supabase service-role key. It submits observations through the PriceTrack PH website API endpoint.
