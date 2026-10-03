PriceTrack PH device backup

Contents:
- website.zip: deployed source, API code, source assets, build assets, migrations, lockfile and restore tools.
- database/catalog.json: live public/application schema definitions, functions, indexes, policies, grants, sequences, scheduled job definitions and table export bounds.
- database/*.ndjson: every exported application row, with original IDs and values.
- device-settings.json: PriceTrack browser preferences. Access tokens are excluded.
- manifest.json: timestamps, deployed commit and per-table exported counts.

No backup is stored in Supabase. Exporting reads data and consumes network transfer.
Keep the Settings page open until the download finishes. For a consistent export,
stop collectors and other recording activity before starting: this is a paginated
live export, not a PostgreSQL point-in-time snapshot. Changes during export may
cause the backup to fail validation and require another attempt.

Restoration:
1. Extract website.zip and deploy its code with npm ci / npm run build.
2. Supply your original server secrets again. Values are deliberately excluded;
   required variable names are listed in manifest.json. No login passwords or API
   secret keys are part of this download.
3. Create an EMPTY Supabase project with the required extensions listed in
   database/catalog.json. Install Python and pip install 'psycopg[binary]'.
4. Run backup/restore.py PATH_TO_BACKUP.zip --database-url YOUR_NEW_DATABASE_URL.
   It restores application tables/rows/IDs, functions, indexes, policies, grants,
   triggers and sequence values in a transaction. A nonempty target is rejected.
5. Review/recreate cronJobs from catalog.json and reconnect Realtime publications
   if their publication names differ. Scheduled jobs are not enabled automatically.
6. device-settings.json can be used to restore this browser's PriceTrack preferences.

This is an application backup, not a copy of Supabase platform internals, usage
logs or billing records. This project had no Auth users or Storage objects when
this exporter was added; the exporter refuses to silently omit them if added later.
Product image URLs are saved as database values. Remote Shopee images themselves
are hosted by Shopee and are not downloaded into this backup.
