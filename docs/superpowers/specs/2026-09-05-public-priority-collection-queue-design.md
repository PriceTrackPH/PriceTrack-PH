# Public Priority Collection Queue Design

Date: September 5, 2026

## Goal

Let a mobile user request collection of an untracked Shopee product by copying its link from the Shopee app and pasting it into the existing PriceTrack PH search box. The private admin collector processes these requests before its normal random due-product work. Desktop users are directed to the PriceTrack PH Chrome extension instead and do not create queue requests.

## Fixed scope

This change adds only the public request queue and its connection to the existing admin collector. It does not change product reports, price recording, Chrome extension behavior, sold-out detection, the 15-day sold-out schedule, collection history layout, the 50-success limit, the one-hour collector cooldown, or other pages.

## Mobile lookup and queue behavior

1. A mobile user copies a supported product link from the Shopee app and pastes it into the existing homepage search box.
2. PriceTrack resolves the link to its stable Shopee shop ID and product ID.
3. If the product already has a PriceTrack record, PriceTrack opens the existing report and does not create a queue request.
4. If the product is untracked, PriceTrack creates one pending priority request and displays:

   > This product hasn't been tracked yet. It has been added to the PriceTrack collection queue and will be checked soon.

5. Invalid or unsupported links are rejected by the existing validation and are not queued.

## Desktop lookup behavior

- Desktop Chrome, Edge, Brave, and other PC browsers never add an untracked product to the public priority queue.
- A tracked product still opens its existing PriceTrack report normally.
- For an untracked product, the desktop user is encouraged to install or use the PriceTrack PH Chrome extension and receives the existing guidance:

  > This product hasn't been tracked yet. Open it on a PC with the PriceTrack PH Chrome extension to record its first price and variations.

- The desktop lookup does not consume daily queue allowance and does not create or update a queue entry.
- Queue eligibility is determined from the visitor's mobile-versus-desktop request context, not from the pasted link format alone. A Shopee short link pasted on a desktop remains a desktop lookup; a full Shopee product link pasted on mobile remains eligible for the mobile queue.

## Queue order and duplicates

- Pending requests are processed oldest first.
- Marketplace, shop ID, and product ID form the queue identity.
- Only one pending request can exist for a product.
- Repeating the same request does not create a second row, consume another daily allowance, or change the request's original queue position.
- A leased request cannot be claimed by another collector until its lease expires or is released.

## Per-user daily limit

- Each anonymous mobile user/device may add up to 100 distinct untracked products per Philippine calendar day.
- The existing anonymous browser installation/device identifier identifies the user for this limit; no account or personal information is required.
- The daily boundary is calculated in `Asia/Manila` and resets at 12:00 AM Philippine time.
- Duplicate requests for an already-pending product do not consume the allowance again.
- Existing tracked-product lookups remain available after the limit is reached, on both mobile and desktop.
- The 101st distinct untracked-product request displays:

   > You've reached today's 100-product request limit. You can request more products tomorrow.

- A failed request that has been removed from the queue may be requested again after the user's next daily reset.

## Admin collector behavior

1. Start collection remains a manual admin action.
2. Each claim first selects the oldest eligible pending public request.
3. If no eligible priority request exists, the collector uses the existing random due-product claim.
4. The product opens in the existing dedicated Shopee tab and records through the existing Chrome extension.
5. A successful record completes the priority request and prevents that product from being selected again on the same Philippine day.
6. A failed or interrupted attempt releases the request for a later attempt according to the existing collector failure behavior.
7. Priority and random products both count toward the existing 50-success run limit.
8. Reaching 50 successes still saves history, stops collection, and starts the existing one-hour manual-restart countdown.

## Recording by another Chrome extension user

- Any successful record-price submission for a queued product completes its pending request, regardless of whether it came from the admin collector or a regular PriceTrack Chrome extension user.
- If the admin collector has already opened that product, its existing exact-product completion polling recognizes the record, counts one success, and moves on.
- If the record happens before an admin claim, the request is no longer eligible and the collector skips it.
- A later mobile lookup opens the newly available product report instead of displaying the queue message.

## Data model

Add a private `public_collection_requests` table containing:

- Stable marketplace, shop ID, and product ID identity
- Canonical Shopee URL
- Original request timestamp used for FIFO ordering
- Status: pending, leased, completed, or removed
- Lease timestamp and attempt metadata needed for safe collector recovery
- Completion timestamp

Add a private daily request-quota table keyed by a one-way hash of the anonymous device identifier plus the Philippine request date. Neither table is publicly readable.

Database constraints enforce one active request per product. Database functions atomically enqueue requests, consume daily allowance, claim the oldest pending request, release a failed lease, and complete a request after recording.

## Interfaces

- Extend the existing public Shopee-link resolution/lookup flow to enqueue only after a valid untracked identity is resolved from a mobile request.
- Preserve the existing extension-install guidance for untracked desktop requests and do not call the queue endpoint for them.
- Extend `/api/admin-pc-collector?action=claim` to try the priority claim before the existing random claim.
- Extend release handling so a priority lease becomes pending again when an attempt is interrupted.
- Extend the `record-price` success path to complete a matching pending request.
- Keep all administrative database operations behind existing server-side service credentials.

## Abuse and privacy protection

- Accept only supported Shopee Philippines identities resolved by existing validation.
- Reject queue creation from desktop request contexts even if a client attempts to call the public queue interface directly.
- Hash the anonymous device identifier before storage.
- Enforce the 100-per-day limit atomically in the database so concurrent requests cannot bypass it.
- Do not store personal data, full browsing history, or unrelated URLs.
- Do not expose the queue or device quota tables through public read policies.

## Failure handling

- If queue insertion fails, show a temporary request failure rather than claiming that the product was queued.
- If a priority request points to a product that has since been recorded, mark it completed and claim the next request.
- If the admin product tab closes or collection stops during processing, release the priority lease.
- Expired leases become eligible again without creating another queue entry.
- Recording remains the source of truth: a successful product record wins over queue state.

## Testing and verification

Tests must cover:

- Valid untracked mobile links enqueue once and show the new message.
- Untracked desktop lookups show extension guidance and never enqueue, including Chrome, Edge, Brave, and other PC browsers.
- Mobile queue eligibility does not depend on whether the pasted Shopee link is short or full-length.
- Tracked and invalid links are not queued.
- Requests claim oldest first.
- Duplicate requests preserve their original position and do not consume quota twice.
- Exactly 100 distinct requests succeed for one device/date; request 101 is rejected.
- A different device has its own allowance.
- The same device receives a new allowance after Philippine midnight.
- Priority requests are selected before random due products.
- Successful admin or regular-extension recording completes the request.
- Concurrent claim and record operations cannot create duplicate collection.
- Existing random collection, daily deduplication, sold-out scheduling, history, 50-success stopping, and one-hour countdown tests remain green.

Production verification will confirm the public message, FIFO claim order, extension-first completion, daily-limit boundary, and unchanged existing collector behavior.
