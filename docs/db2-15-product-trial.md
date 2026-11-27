# Fifteen-product migration trial

Branch: `db2-15-product-trial`. **Local preparation only; not activated.**
No production schema, deployment, environment setting, product owner, or stored
product has changed as part of this branch. Do not enable database routing or
delete any DB1 products based on these changes alone.

Capacity policy: at most **15,000 product identities** per database. New identities
roll over to the next configured, available database in numeric order. Existing
products continue updating their assigned owner even after it stops accepting new
products. Registering DB3 or later does not move existing products automatically.
If the next database is not ready, new assignment fails instead of creating a
duplicate elsewhere. History growth and actual byte capacity remain separate
capacity checks.

## Scope

The proposed IDs are fixed in `server/product-migration.js`: 142734, 142732,
142731, 142730, 142729, 142728, 142727, 142726, 142724, 142723, 142722,
142721, 142720, 142719, 142718. These are fifteen recent DB1 products,
separate from the three existing pilot identities.

Read-only preflight on November 27, 2026 found 15 products, 25 variations,
25 observations, 15 daily checks, and no extension-visit, favorite, backlog,
or active-lease rows for this selection. These counts are a checkpoint, not a
backup: repeat the preflight and freeze concurrent writes before copying.

## Implemented locally

- Private directory maps each saved numeric ID and external Shopee identity to
  one database. It stores ownership, not a second product record or history.
- Read-only ownership lookup never assigns an unknown identity, and rejects
  migrations, invalid owners, missing credentials, and unreachable directories.
- Product reports, watchlist histories, server-rendered offers, title search,
  suggestions, featured products, and discovery can read the owning database.
- Admin check status and lease release can find a moved product by saved ID.
- Community saved-product reads and conditional lease updates can split across
  owners while retaining the original lease/status predicates.
- Staged DB1 trigger refuses writes that would recreate a migrated identity.
- Copy verification compares every field across product, variation, history,
  daily-check, extension-visit, favorite, and backlog tables. Equal row counts
  alone do not establish a valid copy. Active leases block the operation.
- Cutover checks explicitly distinguish a verified copy from verified runtime
  routing. No destructive migration command is provided while coverage is
  incomplete.

## Still required before copying/cutover

1. Route legacy direct extension and scheduled recorder entry points for these
   fifteen identities. Current DB1 forwarding and DB2 recorder are restricted to
   the original three-product pilot; changing the observations API alone is
   insufficient.
2. Implement and verify cross-database admin/community Normal Queue selection,
   summaries, queue outcomes, Favorites, store/priority handoffs, and saved batch
   creation/completion. Owner-aware status reads do not replace these claims.
3. Deploy DB2's required recorder/queue functions with the same production
   validation and ordering. Preserve unrelated products and current rules.
4. Verify all public request paths, sitemap, admin health/export/backup paths,
   and store imports against moved identities. Preserve global product IDs.
5. Freeze writes for the selected identities; export all related rows and a
   recoverable backup. Copy them with original IDs/timestamps; compare complete
   snapshots and recheck that the frozen source has not changed.
6. Switch ownership in a controlled cutover. Test the real website, extension,
   admin collector, public collector, and scheduled collector. Only after all
   checks succeed, remove DB1 rows and verify exactly one stored product per
   identity, with complete history in DB2. Keep the backup outside live tables.

The three-product pilot and automatic allocation of all new products remain
separate. This branch does not authorize silently expanding the trial.
