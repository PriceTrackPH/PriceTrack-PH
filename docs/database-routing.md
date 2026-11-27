# Product database routing

Products have one authoritative full record and history, identified by a private
DB1 directory. Saved numeric IDs do not change when a product moves. DB1 keeps
collection scheduling entries for remote products, without titles, images,
variation details or price observations. Existing queue RPCs use those entries
and the inherited local tables, preserving ranking, leases, store rotation,
sales windows and queue precedence.

## Capacity and additional databases

`product_databases` registers db1 through db5 initially. Each database has a
15,000-product hard assignment limit. Existing DB1 products above that limit
remain in DB1 until separately migrated; enabling routing does not rebalance
other products. New identities fill configured, available destinations in
numeric order. Existing identities always retain their owner. Unavailable or
full destinations never cause an existing product to be duplicated elsewhere.

For DB3 or later: prepare the same product schema, apply
`supabase/routing/owned-database.sql` and `backup/export.sql`, deploy
`supabase/functions/record-price-owned`, add server-only
`SUPABASE_DB3_URL`, `SUPABASE_DB3_SECRET_KEY`, and
`SUPABASE_DB3_PUBLISHABLE_KEY` (legacy anon JWT for the Edge gateway), and redeploy.
Only then enable its `capacity_available` and `accepts_new` registry flags.
The same convention supports db1 through db999 without another routing change.
`reserved_slots` accounts for physical legacy pilot rows outside directory
assignments. DB2 currently needs three reserved slots for the original pilot.
Product limits do not prevent history growth from filling a database's byte quota.

## Recording and collection

The observations API atomically assigns new identities. The original DB1 Edge
recorder also resolves ownership before writing when `database_routing_live` is
on, preserving existing extension entry points. Remote recordings require the
server's signed routing token and assigned global ID. The destination validates
and records the original payload, then returns a private receipt. The API mirrors
only scheduling/availability/check state centrally and completes the original
Priority/Store handoff. Firefox/Edge queue only newly recorded identities.
Private receipts and service credentials never reach extension clients.

Admin, community and scheduled collectors claim work centrally. Full names,
images, variations and price history come from the owner. Source guards reject
writes for moved or frozen identities. Failures do not fall back to DB1 prices.
The existing three-product pilot remains independent while general routing is off.

## Readers and recovery

Reports, watchlists, SEO offers, title lookup, suggestions, discovery, featured
products and sitemap use ownership-aware reads. Backup archives include separate
catalogs and table files per database. Physical inherited rows export only once.
Restore each database into its own empty target with `backup/restore.py` and
`--database db1`, `--database db2`, etc.

Flags: server `PRICETRACK_DATABASE_ROUTING=1`, client
`VITE_PRICETRACK_DATABASE_ROUTING=1`, and DB1 site setting
`database_routing_live=true`. Prepare code and destinations before activation.
Never disable the readers or restore old production code while products remain
owned elsewhere. Rollback requires freezing writes and verifying current owner
histories, including observations recorded after migration, before moving back.
