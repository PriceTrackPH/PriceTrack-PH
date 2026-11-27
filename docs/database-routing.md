# Database routing rollout

Status: three-product pilot wiring implemented. The general directory rollout
remains disabled. Do not enable `PRICETRACK_DATABASE_ROUTING=1` yet.

## Three-product pilot

The pilot covers only 1408391598:29280298218, 276556301:19841104743,
and 70046721:45369645174. Other products keep the existing DB1 path.

On production, ordinary extension/API, admin, and scheduled recordings first
enter DB1's existing `record-price` function. When DB1's site_settings row
`db2_pilot_live` is true, those three price recordings are forwarded to the fixed
production observations API with a server-signed handoff. The API verifies DB1,
re-signs authenticated scheduled recordings for DB2, and sends them to the
restricted DB2 recorder. A saved check receipt updates DB1's collection status,
activity, metadata, and priority/store handoff; no price history is copied back.
Terminal page outcomes keep the existing DB1 behavior during this pilot.

Product reports, watchlist prices, and server-rendered offer summaries read
these products from DB2 when the pilot is enabled. History failures do not fall
back to stale DB1 prices. DB1 retains temporary scheduling/product copies until
the general migration is complete. This pilot does not yet establish the final
one-product-per-database storage layout.

Activation order:

1. Deploy the DB2 recorder with check receipts and current production validation.
2. Sync and verify complete DB1 histories for all three products in DB2.
3. Configure/deploy production API and frontend with PRICETRACK_DB2_PILOT=1,
   PRICETRACK_DB2_PILOT_LIVE=1, both existing three-product allowlists, and DB2
   URL/public recorder key/server secret. Keep the general routing flag off.
4. Deploy DB1's forwarding recorder. Missing/false db2_pilot_live keeps DB1 writes.
5. Verify credentials, readers, and handoff, then enable db2_pilot_live. Confirm a
   real extension recording writes DB2 prices and updates DB1 collection status.

Rollback: disable db2_pilot_live first. Before disabling DB2 readers, sync any
pilot-only observations back to DB1 so displayed history is not lost. Never
delete the original products as an activation or rollback shortcut.

The server asks DB1's private `assign_product_database` RPC for an identity's
owner, then sends the unchanged payload to that owner's `record-price` function.
Only server-configured database endpoints and public recorder keys are accepted.
A directory failure, invalid owner, or missing destination stops the request;
there is no fallback that could create the same product in another database.
Existing preview-only three-product pilot behavior remains when routing is off.

## Required before activation

- Review/apply the staged `product_database_directory` migration to DB1. It
  backfills existing identities as DB1 and implements private atomic assignments,
  migration blocking, and capacity checks. No database accepts new identities
  until an operator explicitly enables its accepts_new/capacity_available flags.
  The product cap is 15,000 per database. Configured destinations fill in numeric
  order; a full destination closes to new assignments and the next configured,
  available database receives the next new identity. Existing identities retain
  their owner. DB1–DB5 are pre-registered; later DB numbers can be registered
  without editing application routing code.
  RPC retries preserve the owner even when that database is full or unavailable.
  Capacity monitoring must consider bytes/history growth as well as product count.
- Deploy the full recording dependencies on the destination. The restricted
  `record-price-db2-pilot` function is not a production recorder.
- Route admin collector's direct recording/check-status calls and scheduled
  Supabase collector through the same ownership lookup. Community collection
  currently uses DB1 for claims, remaining counts, status, and outcomes.
- Route product history, watchlist, reports, and queue reads to the owning
  database. Preserve product IDs during migration so saved watchlists survive.
- Sync complete product history while controlling concurrent writes, verify it,
  switch ownership, and verify recordings and all reads before deleting DB1 rows.
  Do not delete the current three pilot originals until this is complete.

## Server configuration

DB1 directory uses `SUPABASE_URL` (or `VITE_SUPABASE_URL`) and the existing
`SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY`. Each additional owner uses
`SUPABASE_DB2_URL` and `SUPABASE_DB2_PUBLISHABLE_KEY` (likewise DB3–DB5).
Never put directory credentials in a `VITE_` variable or extension bundle.

No production configuration, database ownership, or product data changes are
part of this endpoint patch.
