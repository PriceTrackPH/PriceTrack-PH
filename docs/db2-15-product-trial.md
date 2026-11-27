# Fifteen-product DB2 trial — November 28, 2026 Philippine time

## Current live state
Website/API implementation is deployed at production commit 09a5f8a.
DB1 directory/control-plane and DB1/DB2 physical-row backup RPCs are installed.
DB1 record-price v35 and scheduled collector v2 are deployed; DB2's signed
record-price-owned v1 is deployed. General routing remains OFF. Existing
three-product pilot behavior is unchanged.

The selected 15 products are COPIED and fully field-verified in DB2, but are
NOT reassigned. Their DB1 originals remain authoritative. DB2 currently has
18 products: three original pilot products plus 15 temporary trial copies.
All 15 temporary migration freezes were released after the cutover confirmation
expired. No full DB1 products were deleted; zero remote scheduling entries exist.
New recordings therefore still follow existing DB1/pilot behavior.

## Selection and verification
IDs: 142734,142732,142731,142730,142729,142728,142727,142726,142724,142723,
142722,142721,142720,142719,142718.

Snapshot: 15 products,25 variations,25 observations,15 daily checks; zero
extension-visit,favorite,backlog rows. All seven table snapshots matched by full
field SHA256 verification after copy, and the frozen source was unchanged.
A recovery ZIP with snapshot and manifest was saved before copying.

Build, Edge TypeScript checks, owned-recording/directory/history/search tests,
PGlite capacity/central-queue integration, and inherited physical backup tests
passed. Four older unrelated test failures reproduce on production 24aa324.
Actual live rollback/cutover SQL was NOT confirmed: Supabase's required
confirmation expired. Do not claim the live queue cutover passed.

## Resume safely
1. Confirm the Supabase cutover prompt while the user is present.
2. Re-freeze only these 15 DB1 directory entries; drain writes and recheck leases.
3. Re-export source and compare with DB2. Since freezes were released, source
   data may have changed. Refresh target rows and recovery backup if necessary;
   never delete newly recorded observations to force a match.
4. Run the rollback-only queue/summary/status test and observe its result.
5. Prepare production routing flags and DB2 capacity (three reserved pilot
   slots); verify owner-aware runtime paths before permanent source removal.
6. Atomically assign these 15 to DB2, remove their full DB1 rows, and create
   central scheduling/check markers. Verify zero full source duplicates.
7. Activate and verify direct extensions, API captures, admin/community and
   scheduled collectors, reports, watchlists, search, sitemap and backup.
8. Record final evidence and counts. Leave original three pilot originals alone.

Capacity is 15,000 new assigned products per database including reserved slots.
Existing DB1 products above the cap are grandfathered until separately migrated.
DB3+ must be configured/prepared before accepting rollover; no silent fallback.
See database-routing.md for configuration and rollback requirements.
