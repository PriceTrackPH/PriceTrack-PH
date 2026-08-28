# PriceTrack PH Google Drive archive setup

This is a one-time setup. After it is enabled, the private affiliate tools automatically save:

- generated XLSX files to `PriceTrack PH/Exports`
- successfully imported Shopee CSV files to `PriceTrack PH/Imports`

## Google Apps Script

1. Open `https://script.google.com` using the Google account that owns the PriceTrack PH folder.
2. Create a new project named `PriceTrack PH Drive Archive`.
3. Replace the default code with `google-apps-script/affiliate-drive-archive.gs` from this repository.
4. Open **Project Settings > Script properties** and add:
   - `EXPORT_FOLDER_ID` = `1txTfJw3uX_vc1nWO7f5U_AbA-mXnndvR`
   - `IMPORT_FOLDER_ID` = `1tic2GoebxrKtE5az5ojO_x3jkYblhVkr`
   - `ARCHIVE_SECRET` = a private random value of at least 32 characters
5. Choose **Deploy > New deployment > Web app**.
6. Set **Execute as** to `Me` and **Who has access** to `Anyone`.
7. Deploy, authorize Drive access, and copy the `/exec` web-app URL.

## Vercel

Add these Production environment variables and redeploy:

- `GOOGLE_DRIVE_ARCHIVE_WEB_APP_URL` = the Apps Script `/exec` URL
- `GOOGLE_DRIVE_ARCHIVE_SECRET` = the same private `ARCHIVE_SECRET`

Keep the Drive folder's General access set to **Restricted**. Do not commit either secret value.
