# Design Q Store Scanner Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Shopee store importing to a dedicated private Store Scanner page that scans every regular page, expands all sold-out products, preserves complete scan history, and closes the Shopee tab only after successful persistence.

**Architecture:** Split store-import UI/state out of `AdminCollector.tsx` into `AdminStoreScanner.tsx`, while retaining the existing private API and extension bridge. Extend the store scan contract so every discovered identity carries a `soldOut` classification and progress carries exact page counts. Add an append-only private scan-history table and deferred sold-out store requests; use a page-to-extension persistence acknowledgement so the extension coordinator closes the scanner tab only after all batches and the completed history row are saved.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Node test runner, Chrome Extension Manifest V3, Vercel Functions, Supabase PostgreSQL/REST RPC.

**Spec:** `docs/superpowers/specs/2026-09-09-design-q-store-scanner-page.md`

## Global Constraints

- Change only the Store Scanner location, store scan behavior, Store Scan History, sold-out discovery/deferment, and successful scanner-tab closing.
- Keep `/admin/collector`, normal Collection history, collection limits, cooldowns, queue order, public pages, product reports, and unrelated text/styles unchanged.
- The history heading is exactly **Store Scan History**.
- **Found** equals all unique regular and sold-out products discovered.
- A Store value opens Shopee but uses plain surrounding table text styling: no blue color and no underline.
- Sold-out store discoveries are deferred for 15 days, then become eligible for the normal Collector.
- A scan is completed only after final-page detection, Sold Out `See More` exhaustion, batch persistence, and history persistence.
- Only a successfully completed scan closes its dedicated Shopee tab.
- All new public-schema tables use RLS, revoke `anon`/`authenticated` access, and are accessed only with the existing server-side secret.
- Before applying Supabase changes, check the current Supabase changelog and relevant database/RLS documentation as required by the Supabase skill.

---

### Task 1: Extend the Store Scan Contract

**Files:**
- Modify: `src/store-import-contract.ts`
- Modify: `server/store-import-contract.js`
- Modify: `tests/store-import-contract.test.mjs`

**Interfaces:**
- Produces: `StoreProductIdentity = { shopId: string; externalProductId: string; productUrl: string; soldOut: boolean }`.
- Produces: `normalizeDiscoveredProducts(values, maximum)` preserving a strict boolean `soldOut` value and deduplicating by `shopId:externalProductId`.
- Consumes: untrusted extension JSON objects.

- [ ] **Step 1: Write failing contract tests**

Add cases proving sold-out classification is preserved, omitted values become `false`, invalid truthy values are not accepted, and duplicate identities merge to sold out when either occurrence is sold out:

```js
const products = normalizeDiscoveredProducts([
  { shopId: "12", productId: "34", soldOut: false },
  { shopId: "12", productId: "34", soldOut: true },
  { shopId: "56", productId: "78" },
]);
assert.deepEqual(products, [
  { shopId: "12", externalProductId: "34", productUrl: "https://shopee.ph/product/12/34", soldOut: true },
  { shopId: "56", externalProductId: "78", productUrl: "https://shopee.ph/product/56/78", soldOut: false },
]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/store-import-contract.test.mjs`

Expected: FAIL because the normalized identities do not yet contain or merge `soldOut`.

- [ ] **Step 3: Implement the minimal shared contract change**

Use the same merge logic in TypeScript and server JavaScript:

```ts
const existing = productsByKey.get(key);
const soldOut = candidate.soldOut === true;
if (existing) {
  existing.soldOut ||= soldOut;
  continue;
}
productsByKey.set(key, { shopId, externalProductId, productUrl, soldOut });
```

Reject arbitrary status strings and never trust a product URL supplied by the browser; continue rebuilding the canonical URL from numeric IDs.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/store-import-contract.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add src/store-import-contract.ts server/store-import-contract.js tests/store-import-contract.test.mjs
git commit -m "feat: classify sold-out store discoveries"
```

### Task 2: Add Append-Only Store Scan History and Deferred Sold-Out Requests

**Files:**
- Create: a Supabase CLI-generated migration named `design_q_store_scan_history`
- Create: `tests/store-scan-history-migration.test.mjs`
- Modify: `tests/store-collection-queue-migration.test.mjs`

**Interfaces:**
- Produces table: `public.store_scan_history` keyed by `scan_id uuid`.
- Produces request fields: `discovered_sold_out boolean`, `eligible_at timestamptz`.
- Replaces RPCs: `begin_store_collection_scan`, `import_store_collection_batch`, `finish_store_collection_scan`, `claim_oldest_store_collection_request`, and `store_collection_queue_pending_count` with compatible signatures plus Design Q behavior.

- [ ] **Step 1: Check current Supabase tooling and documentation**

Run:

```bash
supabase --version
supabase migration --help
```

Fetch `https://supabase.com/changelog.md`, scan relevant breaking changes, and verify current RLS/function guidance. Do not expose service-role credentials to frontend code.

- [ ] **Step 2: Create the migration using the CLI**

Run: `supabase migration new design_q_store_scan_history`

Expected: one timestamped empty SQL file under `supabase/migrations/`.

- [ ] **Step 3: Write failing migration assertions**

Test for all required SQL invariants:

```js
assert.match(sql, /create table public\.store_scan_history/i);
assert.match(sql, /scan_id uuid primary key/i);
assert.match(sql, /sold_out integer not null default 0/i);
assert.match(sql, /pages_current integer not null default 0/i);
assert.match(sql, /pages_total integer not null default 0/i);
assert.match(sql, /discovered_sold_out boolean not null default false/i);
assert.match(sql, /eligible_at timestamptz not null default now\(\)/i);
assert.match(sql, /interval '15 days'/i);
assert.match(sql, /enable row level security/i);
assert.match(sql, /revoke all .* anon, authenticated/is);
```

Also assert the claim RPC filters `eligible_at <= now()` and the pending-count RPC excludes future deferred requests.

- [ ] **Step 4: Run migration tests and verify RED**

Run: `node --test tests/store-scan-history-migration.test.mjs tests/store-collection-queue-migration.test.mjs`

Expected: FAIL because the new table and fields do not exist.

- [ ] **Step 5: Implement the migration**

Create `store_scan_history` with:

```sql
scan_id uuid primary key,
store_id uuid not null references public.collection_stores(store_id) on delete cascade,
started_at timestamptz not null default now(),
finished_at timestamptz,
status text not null check (status in ('completed','incomplete','interrupted')),
discovered integer not null default 0,
newly_queued integer not null default 0,
duplicate integer not null default 0,
already_tracked integer not null default 0,
sold_out integer not null default 0,
pages_current integer not null default 0,
pages_total integer not null default 0
```

Add `discovered_sold_out boolean not null default false` and `eligible_at timestamptz not null default now()` to `store_collection_requests`.

In `import_store_collection_batch`:

- Count every unique submitted identity once in `discovered`.
- Count `soldOut=true` identities in `sold_out`.
- For a new sold-out identity, insert a deferred request with `eligible_at = now() + interval '15 days'`.
- For regular identities, retain immediate eligibility.
- Never shorten an existing future sold-out deferment during duplicate scans.
- Update both the latest fields on `collection_stores` and the row in `store_scan_history`.
- Accept `p_pages_current` and `p_pages_total`, validating nonnegative values and `current <= total` when total is nonzero.

Keep all functions `security definer set search_path = ''`, explicitly revoke execution from `public`, `anon`, and `authenticated`, and grant only the service-role path already used by the API.

Replace the `collection_stores.last_scan_status` constraint so its terminal values match Design Q exactly: `completed`, `incomplete`, or `interrupted`. The existing API `store-fail` path must write `interrupted`, not the removed `failed` value.

- [ ] **Step 6: Run migration tests and verify GREEN**

Run: `node --test tests/store-scan-history-migration.test.mjs tests/store-collection-queue-migration.test.mjs`

Expected: PASS.

- [ ] **Step 7: Apply and verify safely against Supabase**

Use the configured Supabase execution path to apply the migration. Query `store_scan_history`, inspect function definitions, verify RLS/revokes, insert a transaction-scoped sample scan, and roll back the sample. Run database advisors and confirm no new security or performance findings.

- [ ] **Step 8: Commit the database change**

```bash
git add supabase/migrations tests/store-scan-history-migration.test.mjs tests/store-collection-queue-migration.test.mjs
git commit -m "feat: persist Store Scan History"
```

### Task 3: Extend the Private Store API

**Files:**
- Modify: `api/admin-pc-collector.js`
- Modify: `tests/admin-store-import-api.test.mjs`

**Interfaces:**
- Consumes batch: `{ scanId, products, pagesCurrent, pagesTotal }`.
- Produces totals: `{ discovered, newlyQueued, duplicate, alreadyTracked, soldOut, pagesCurrent, pagesTotal }`.
- Produces history list: `{ scans: StoreScanHistoryRow[], page, pageSize, total }`.
- Consumes history filters: `query`, `status`, `page`, fixed `pageSize=20`.
- Maps `store-fail` to the persisted terminal status `interrupted`.

- [ ] **Step 1: Write failing API tests**

Add tests proving:

```js
assert.deepEqual(JSON.parse(options.body), {
  p_scan_id: scanId,
  p_products: [{ shopId: "12", externalProductId: "34", productUrl: "https://shopee.ph/product/12/34", soldOut: true }],
  p_pages_current: 4,
  p_pages_total: 4,
});
```

Test that `store-history` returns 20 rows maximum, validates status, escapes store search input through URLSearchParams, maps Philippine-independent ISO timestamps, and never exposes the endpoint without the admin token.

Update the existing finish/fail assertion so `store-finish` sends `completed` and `store-fail` sends `interrupted`.

- [ ] **Step 2: Run API tests and verify RED**

Run: `node --test tests/admin-store-import-api.test.mjs`

Expected: FAIL on missing sold-out/page fields and missing history action.

- [ ] **Step 3: Implement API mapping and pagination**

Extend `mapStore` only for latest summary compatibility. Add:

```js
function mapStoreScan(row) {
  return {
    scanId: row.scan_id,
    storeId: row.store_id,
    storeUrl: row.collection_stores.store_url,
    displayName: row.collection_stores.display_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    discovered: safeInteger(row.discovered),
    newlyQueued: safeInteger(row.newly_queued),
    duplicate: safeInteger(row.duplicate),
    alreadyTracked: safeInteger(row.already_tracked),
    soldOut: safeInteger(row.sold_out),
    pagesCurrent: safeInteger(row.pages_current),
    pagesTotal: safeInteger(row.pages_total),
  };
}
```

Use server-side authorization, service-role REST calls, a count query, descending `started_at`, and range-based pagination. Keep the response cache disabled.

- [ ] **Step 4: Run API tests and verify GREEN**

Run: `node --test tests/admin-store-import-api.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the API change**

```bash
git add api/admin-pc-collector.js tests/admin-store-import-api.test.mjs
git commit -m "feat: expose private store scan history"
```

### Task 4: Move the Importer to a Dedicated Store Scanner Page

**Files:**
- Create: `src/AdminStoreScanner.tsx`
- Create: `src/store-scan-ui.ts`
- Create: `tests/admin-store-scanner-page.test.mjs`
- Modify: `src/AdminCollector.tsx`
- Modify: `src/App.tsx`
- Modify: `src/AdminHealth.tsx`
- Modify: `src/SiteSections.tsx`
- Modify: `vercel.json`
- Modify: `tests/admin-collector-page.test.mjs`

**Interfaces:**
- Produces route: `/admin/store-scanner`.
- Produces `StoreScanTotals`, `StoreScanHistoryRow`, and `formatPageProgress(current,total)`.
- Consumes extension messages from `STORE_SCAN_EXTENSION_SOURCE`.
- Consumes the private `store-begin`, `store-batch`, `store-finish`, `store-fail`, and `store-history` API actions.

- [ ] **Step 1: Write failing route and isolation tests**

Assert:

```js
assert.match(app, /pathname === "\/admin\/store-scanner"/);
assert.match(app, /<AdminStoreScanner/);
assert.doesNotMatch(collector, /Import a Shopee store|Saved stores|startStoreScan/);
assert.match(scanner, />Shopee Store Scanner</);
assert.match(scanner, />Store Scan History</);
assert.match(scanner, /Recheck all stores/);
```

Verify the Vercel rewrite and private navigation route exist while existing navigation labels remain unchanged.

- [ ] **Step 2: Write failing state-helper tests**

Test exact totals and sequential recheck behavior:

```js
assert.equal(formatPageProgress(4, 4), "4/4");
assert.equal(formatPageProgress(0, 0), "—");
assert.deepEqual(nextUnscannedStore(["a", "b"], new Set(["a"])), "b");
```

- [ ] **Step 3: Run focused UI tests and verify RED**

Run: `node --test tests/admin-store-scanner-page.test.mjs tests/admin-collector-page.test.mjs`

Expected: FAIL because the new page does not exist and the importer remains in `AdminCollector.tsx`.

- [ ] **Step 4: Implement the dedicated page**

Move store-specific state, bridge listeners, API calls, scan initiation, current scan messages, and saved-store recheck behavior into `AdminStoreScanner.tsx`. Render exact live boxes:

```tsx
<span>Found<strong>{totals.discovered}</strong></span>
<span>New queued<strong>{totals.newlyQueued}</strong></span>
<span>Already queued<strong>{totals.duplicate}</strong></span>
<span>Already tracked<strong>{totals.alreadyTracked}</strong></span>
<span>Sold Out<strong>{totals.soldOut}</strong></span>
<span>Pages scanned<strong>{formatPageProgress(totals.pagesCurrent, totals.pagesTotal)}</strong></span>
<span>Current page<strong>{totals.pagesCurrent || "—"}</strong></span>
```

Render **Store Scan History** with the exact approved columns and 20-row pagination. Store anchors keep `target="_blank" rel="noreferrer"` but use a dedicated plain-text class.

For **Recheck all stores**, create a queue of saved store URLs and start the next scan only after the previous scan reaches completed, incomplete, or interrupted state. Disable Scan store, Recheck, and Recheck all while one scan is active.

- [ ] **Step 5: Remove only store-import UI from Collector**

Delete store-specific imports, types, state, effects, handlers, and the import panel from `AdminCollector.tsx`. Preserve the `Include store-imported products` checkbox, pending count, normal/unlimited buttons, collection history, cooldowns, and collector behavior exactly.

- [ ] **Step 6: Add the route and navigation**

Add `/admin/store-scanner` routing in `App.tsx`, add the private navigation link beside Collector wherever the admin nav is constructed, allow it in `SiteSections.tsx`, and add a Vercel rewrite to `/`.

- [ ] **Step 7: Run focused UI tests and verify GREEN**

Run: `node --test tests/admin-store-scanner-page.test.mjs tests/admin-collector-page.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit the page move**

```bash
git add src/AdminStoreScanner.tsx src/store-scan-ui.ts src/AdminCollector.tsx src/App.tsx src/AdminHealth.tsx src/SiteSections.tsx vercel.json tests/admin-store-scanner-page.test.mjs tests/admin-collector-page.test.mjs
git commit -m "feat: add dedicated Store Scanner page"
```

### Task 5: Style the New Page Without Changing Other Pages

**Files:**
- Modify: `src/precision-fix.css`
- Modify: `tests/admin-store-scanner-page.test.mjs`

**Interfaces:**
- Produces Store Scanner-only CSS classes under `.admin-store-scanner`.
- Preserves existing theme tokens and Collector selectors.

- [ ] **Step 1: Write failing style tests**

Assert Store Scanner selectors provide responsive cards, a scrollable table, light-mode foreground/background contrast, and the exact plain store link treatment:

```js
assert.match(css, /\.store-scan-store-link\s*\{[^}]*color:\s*inherit;[^}]*text-decoration:\s*none;/s);
assert.match(css, /html:not\(\[data-theme="dark"\]\) \.admin-store-scanner/s);
assert.match(css, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(/);
```

Also assert no global `a`, `table`, `.health-page`, or `.admin-collector-panel` selector is modified for this feature.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/admin-store-scanner-page.test.mjs`

Expected: FAIL because Store Scanner styles do not exist.

- [ ] **Step 3: Add scoped styles**

Use existing border, background, lavender button, green focus, and light-mode colors. Scope every new rule beneath `.admin-store-scanner`. The link rule must be:

```css
.admin-store-scanner .store-scan-store-link {
  color: inherit;
  text-decoration: none;
}
.admin-store-scanner .store-scan-store-link:hover,
.admin-store-scanner .store-scan-store-link:visited {
  color: inherit;
  text-decoration: none;
}
```

Keep the table horizontally scrollable on narrow screens and do not redesign global admin components.

- [ ] **Step 4: Run focused tests and build**

Run:

```bash
node --test tests/admin-store-scanner-page.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit scoped styling**

```bash
git add src/precision-fix.css tests/admin-store-scanner-page.test.mjs
git commit -m "style: format Store Scan History"
```

### Task 6: Detect Page Maximums, Sold-Out Cards, and Sold Out `See More`

**Files:**
- Modify: `extension/store-scanner.js`
- Modify: `tests/extension-store-scanner.test.mjs`

**Interfaces:**
- Produces `pageProgress(root): { current: number; total: number } | null`.
- Produces `storeProductEntries(root): Array<{ shopId, externalProductId, soldOut }>`.
- Produces `findSoldOutSeeMore(root): Element | null` scoped to the Sold Out section.
- Produces extension progress messages containing `products`, `discovered`, `soldOutDetected`, `pagesCurrent`, and `pagesTotal`.

- [ ] **Step 1: Write failing DOM-helper tests**

Use small fake DOM fixtures to verify:

- `3/3`, `4/4`, and `20/20` counters parse correctly.
- A current-page button plus numbered last button is a safe fallback.
- `current === total` ends regular pagination even if the icon-only Next selector is ambiguous.
- Sold-out overlays/class text mark only their own product card.
- Regular recommendations outside the store grid remain excluded.
- Sold Out `See More` is found only inside the section headed exactly `Sold Out`.
- An unrelated page `See More` is ignored.
- Duplicate regular/sold-out appearances merge into one identity with `soldOut=true`.

- [ ] **Step 2: Run scanner tests and verify RED**

Run: `node --test tests/extension-store-scanner.test.mjs`

Expected: FAIL on missing progress parsing, classification, and Sold Out expansion helpers.

- [ ] **Step 3: Implement isolated DOM helpers**

Keep URL parsing separate from DOM classification. Determine a card's sold-out state only from its closest product-card container and exact `Sold Out` text/class markers. Locate the Sold Out section from its exact heading plus its enclosing container; never search the whole document for a generic `See More` button.

Return progress using integers:

```js
{ current: 3, total: 3 }
```

Treat `current >= total && total > 0` as final regular-page confirmation. Retain disabled/missing Next as fallback.

- [ ] **Step 4: Implement exhaustive Sold Out expansion**

On the final regular page:

```js
while (true) {
  collectAndSendNewSoldOutEntries();
  const seeMore = findSoldOutSeeMore(document);
  if (!seeMore || isPageControlDisabled(seeMore)) break;
  const before = soldOutFingerprint(document);
  seeMore.click();
  if (!(await waitForSoldOutGrowth(before))) throw new Error("The Sold Out section did not finish loading.");
}
```

Do not complete on a timeout. Send an incomplete terminal message when Sold Out expansion cannot be verified.

- [ ] **Step 5: Run scanner tests and verify GREEN**

Run: `node --test tests/extension-store-scanner.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit scanner behavior**

```bash
git add extension/store-scanner.js tests/extension-store-scanner.test.mjs
git commit -m "feat: complete multi-page sold-out store scans"
```

### Task 7: Acknowledge Persistence Before Closing the Shopee Tab

**Files:**
- Modify: `extension/admin-collector-bridge.js`
- Modify: `extension/background.js`
- Modify: `extension/manifest.json`
- Modify: `src/AdminStoreScanner.tsx`
- Modify: `tests/extension-store-scan-bridge.test.mjs`
- Modify: `tests/admin-store-scanner-page.test.mjs`

**Interfaces:**
- Scanner terminal event: `storeScanDiscoveryFinished` means DOM discovery ended, not database completion.
- Page acknowledgement: `{ source: STORE_SCAN_PAGE_SOURCE, type: 'persisted', scanId }`.
- Background action: close `storeTabId` only after valid matching persisted acknowledgement.

- [ ] **Step 1: Write failing coordinator tests**

Test these exact cases:

- Discovery completion alone does not call `chrome.tabs.remove`.
- A persisted acknowledgement from the matching admin tab removes the stored session, persists session removal, and closes only its `storeTabId`.
- An acknowledgement from another tab or scan ID does nothing.
- Incomplete, interrupted, verification-blocked, or API-failed scans remain open.
- Closing the scanner tab before acknowledgement relays Interrupted/Incomplete history once.
- The manifest bridge match moves from `/admin/collector*` to `/admin/store-scanner*`.

- [ ] **Step 2: Run bridge tests and verify RED**

Run: `node --test tests/extension-store-scan-bridge.test.mjs tests/admin-store-scanner-page.test.mjs`

Expected: FAIL because no persistence acknowledgement exists.

- [ ] **Step 3: Serialize page-side persistence**

In `AdminStoreScanner.tsx`, chain every batch save onto one promise. On discovery completion:

1. Await the batch chain.
2. Call `store-finish` with completed status and final page counts.
3. Refresh Store Scan History.
4. Post the matching `persisted` acknowledgement.

If any batch or finish call fails, call `store-fail`/interrupted handling, show a concise error, and do not acknowledge persistence.

- [ ] **Step 4: Add bridge and coordinator acknowledgement handling**

Validate source, origin, path, UUID, sender admin tab ID, and active session. Delete and persist the session before calling:

```js
chrome.tabs.remove(session.storeTabId);
```

This ordering prevents the `tabs.onRemoved` listener from writing a false interrupted result for a completed scan.

- [ ] **Step 5: Increment the extension version**

Change `extension/manifest.json` from `1.0.5` to `1.0.6`. Update manifest assertions to require `1.0.6` and the Store Scanner page match.

- [ ] **Step 6: Run bridge and scanner tests and verify GREEN**

Run:

```bash
node --test tests/extension-store-scan-bridge.test.mjs tests/extension-store-scanner.test.mjs tests/admin-store-scanner-page.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit persistence acknowledgement**

```bash
git add extension/admin-collector-bridge.js extension/background.js extension/manifest.json src/AdminStoreScanner.tsx tests/extension-store-scan-bridge.test.mjs tests/admin-store-scanner-page.test.mjs
git commit -m "feat: close completed store scanner tabs safely"
```

### Task 8: Full Regression, Visual Verification, Release, and Deployment

**Files:**
- Create: `release/PriceTrack-PH-Extension-1.0.6.zip`
- Modify only if a verified defect is found: files already listed in Tasks 1–7

**Interfaces:**
- Produces tested website build and versioned extension package.
- Deploys the committed source through the repository's existing GitHub/Vercel production workflow.

- [ ] **Step 1: Run the complete automated test suite**

Run:

```bash
node --test tests/*.test.mjs
npm run build
git diff --check
```

Expected: every test passes, build exits 0, and `git diff --check` has no output.

- [ ] **Step 2: Inspect the production diff boundary**

Run: `git diff <production-base>...HEAD --stat` and `git diff <production-base>...HEAD`.

Confirm no unrelated public report, Ads, Affiliate, Health data, collector scheduling, cooldown, or normal Collection history behavior changed.

- [ ] **Step 3: Verify locally in dark and light modes**

Start the Vite server and use browser verification for `/admin/store-scanner` and `/admin/collector` at desktop and narrow widths. Confirm:

- Store Scanner is readable in both themes.
- Store anchors look like plain text but open Shopee in a new tab.
- Seven summary boxes wrap cleanly.
- The history table scrolls horizontally on narrow screens.
- Collector no longer contains the importer and otherwise looks unchanged.

- [ ] **Step 4: Request code review and address only verified findings**

Use `superpowers:requesting-code-review` against the Design Q spec and this plan. Apply review feedback using `superpowers:receiving-code-review`, rerun affected tests, and commit fixes separately.

- [ ] **Step 5: Build and verify the extension ZIP**

Create `release/PriceTrack-PH-Extension-1.0.6.zip` containing the extension files at the archive root. Verify:

```bash
unzip -t release/PriceTrack-PH-Extension-1.0.6.zip
unzip -p release/PriceTrack-PH-Extension-1.0.6.zip manifest.json | grep '"version": "1.0.6"'
```

Expected: archive integrity passes and the manifest reports 1.0.6.

- [ ] **Step 6: Deploy the database migration**

Apply the verified migration to the connected Supabase project, query the new table/functions, and run security/performance advisors. Stop deployment if migration verification fails.

- [ ] **Step 7: Publish source and deploy the website**

Push the reviewed commits to a feature branch, create/merge the production change using the connected GitHub repository workflow, and deploy/promote through the connected Vercel project. Verify the production commit matches the reviewed source.

- [ ] **Step 8: Verify production without risking a large scan**

On production:

- Confirm `/admin/store-scanner` loads under private admin access.
- Confirm `/admin/collector` retains its existing behavior.
- Install/load extension 1.0.6.
- Scan one small Shopee store.
- Confirm page progress, Found arithmetic, Sold Out count, history insertion, plain clickable store name, and successful tab closure.
- Trigger or safely simulate one incomplete scan and confirm its tab remains open.
- Recheck the same store and confirm no duplicate active requests.

- [ ] **Step 9: Run final verification before reporting completion**

Use `superpowers:verification-before-completion`. Record the final test count, production deployment URL/status, Supabase migration verification, merged commit SHA, extension ZIP integrity, and small-store scan result.

- [ ] **Step 10: Commit any release metadata only**

```bash
git add release/PriceTrack-PH-Extension-1.0.6.zip
git commit -m "release: package PriceTrack extension 1.0.6"
```
