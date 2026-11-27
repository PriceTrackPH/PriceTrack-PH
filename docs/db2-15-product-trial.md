# Fifteen-product migration trial

Scope: exactly the IDs in `server/product-migration.js`: 142734, 142732, 142731,
142730, 142729, 142728, 142727, 142726, 142724, 142723, 142722, 142721,
142720, 142719, 142718. The original three-product pilot is separate.

## Preparation checkpoint, November 28, 2026 Philippine time

DB1 directory/control-plane and physical-row backup functions are installed.
DB2 owned-recorder dependencies and backup functions are installed. DB1 recorder
v35 supports ownership forwarding; the switch remains off. Scheduled recorder
v2 uses the central check marker. DB2 owned recorder v1 requires signed routing
headers. No selected product has been copied, reassigned or deleted at this
checkpoint. DB1 has 25,019 original products, 25,019 directory entries, zero
remote scheduling entries, and zero destinations accepting new assignments.
DB2 has the original three pilot products only.

## Verification

Build and Edge TypeScript checks pass. Tests cover 15,000-product capacity,
rollover, stable ownership, original global IDs, write guards, remote recording
receipts, queue handoffs, central claims/leases/outcomes/favorites/backlogs,
owner history/search, and multiple-database physical backups. Four unrelated
legacy test failures also reproduce on production commit 24aa324; no collection
rules were changed to alter those expectations.

## Cutover requirements

1. Publish the complete website/API implementation with routing enabled only
   after destination credentials and recorder dependencies are ready.
2. Recheck the selected rows, active leases and all related table counts. Freeze
   their directory entries and drain writes before creating a durable export.
3. Copy original full rows and IDs to DB2. Compare all field values and SHA256
   manifests, not just counts; verify the frozen source remains unchanged.
4. Test central claims/summary/status and membership survival inside a DB1
   transaction that rolls back before the permanent cutover.
5. Atomically change the selected owners, remove their full DB1 records and seed
   their central scheduling/check markers. Preserve original timestamps and
   memberships. Confirm 15 products only in DB2 and zero full DB1 duplicates.
6. Verify deployed reports, search, watchlist, backup, extension recording and
   admin/community/scheduled paths. Keep the original pilot untouched.

`verifyMigrationCopy` and `requireCutoverEvidence` reject incomplete cutovers.
Do not claim migration is complete from this preparation checkpoint alone.
