# Shopee Store Import Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add saved Shopee store scanning and a persistent private store-product queue that participates in normal collector runs when its default-on toggle is enabled.

**Architecture:** A PriceTrack admin-page extension bridge asks the extension background worker to coordinate a scanner running in a Shopee store tab. The React admin page sends normalized product identities to a private Vercel API, which persists saved-store scan metadata and an idempotent Supabase queue. Collector claims remain atomic and ordered priority → store → normal, while existing record-price completion closes matching store requests.

**Tech Stack:** React 19, TypeScript, Vite, Vercel Node functions, Chrome Manifest V3 extension APIs, Supabase Postgres/RPC, Supabase Edge Functions, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-07-shopee-store-import-queue-design.md`

## Global Constraints

- Store scans are private admin operations and never use the public 100-request daily allowance.
- `Include store-imported products` is enabled by default and disabled while a collection run is active.
- Claim order is public/mobile priority queue, store-import queue when enabled, then normal due products.
- Existing 50-success run limit and one-hour cooldown remain unchanged.
- Scanning and rechecking never auto-start collection.
- Saved stores persist and recheck only adds newly discovered untracked products.
- Server authentication remains the existing admin bearer token; scan IDs are correlation values only.
- Service-role credentials remain server-side and both new public-schema tables have RLS enabled with public roles revoked.
- Store scanning requires the updated extension; older extensions retain existing product recording.

---

## File map

- Create `src/store-import-contract.ts`: shared pure validation, normalization, message-shape types, constants, and default toggle behavior.
- Create `api/admin-store-import.js`: authenticated saved-store list, scan start/batch/finish/fail endpoints.
- Create `supabase/migrations/<generated>_store_collection_queue.sql`: saved stores, queue, indexes, RLS, grants, and atomic RPCs.
- Create `extension/admin-collector-bridge.js`: relay between the admin page and extension runtime.
- Create `extension/store-scanner.js`: Shopee store-page discovery, scrolling, normalization, stopping, and progress messages.
- Modify `extension/background.js`: coordinate scan sessions and route messages to the correct admin and Shopee tabs.
- Modify `extension/manifest.json`: register admin and store scan scripts and increment the extension version.
- Modify `src/AdminCollector.tsx`: URL input, Scan/Recheck UI, saved stores, progress, toggle, pending count, and claim parameter.
- Modify `src/precision-fix.css`: responsive store-import and saved-store panel styling.
- Modify `api/admin-pc-collector.js`: store pending summary, claim/release integration, and store claim source.
- Modify `supabase/functions/record-price/index.ts`: complete matching store requests after a successful check.
- Create focused tests under `tests/` for contract, migration, API, extension scanner/bridge, collector ordering, admin UI, and completion.

---

### Task 1: Shared store-import contract

**Files:**
- Create: `src/store-import-contract.ts`
- Create: `tests/store-import-contract.test.mjs`

**Interfaces:**
- Produces: `normalizeShopeeStoreUrl(value: string): { storeKey: string; storeUrl: string; displayName: string } | null`
- Produces: `normalizeDiscoveredProducts(values: unknown, maximum?: number): Array<{ shopId: string; externalProductId: string; productUrl: string }>`
- Produces: `includeStoreImportsDefault(stored: string | null): boolean`
- Produces: message constants `STORE_SCAN_PAGE_SOURCE`, `STORE_SCAN_EXTENSION_SOURCE`, and a maximum of `5000` identities per scan.

- [ ] **Step 1: Write failing contract tests**

Cover `https://shopee.ph/jabraofficialstore#product_list`, trailing slashes/fragments, rejection of product and non-Shopee URLs, numeric ID validation, identity deduplication, canonical product URLs, 5,000-item truncation, and default-on toggle parsing.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/store-import-contract.test.mjs`

Expected: FAIL because `src/store-import-contract.ts` does not exist.

- [ ] **Step 3: Implement the pure contract**

Use `URL`, restrict the hostname to `shopee.ph`, reject product patterns (`-i.<shop>.<item>` and `/product/<shop>/<item>`), normalize the store path to one lowercase path segment, strip search/hash, and deduplicate discovered products by `${shopId}:${externalProductId}`.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/store-import-contract.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store-import-contract.ts tests/store-import-contract.test.mjs
git commit -m "feat: define Shopee store import contract"
```

### Task 2: Saved-store and store-queue database layer

**Files:**
- Create: `supabase/migrations/<timestamp>_store_collection_queue.sql` using `supabase migration new store_collection_queue`
- Create: `tests/store-collection-queue-migration.test.mjs`

**Interfaces:**
- Produces RPC `begin_store_collection_scan(p_store_key text, p_store_url text, p_display_name text, p_scan_id uuid)`.
- Produces RPC `import_store_collection_batch(p_scan_id uuid, p_products jsonb)` returning `discovered`, `newly_queued`, `duplicate`, `already_tracked` integers.
- Produces RPC `finish_store_collection_scan(p_scan_id uuid, p_status text)` returning final saved-store metadata.
- Produces RPC `claim_oldest_store_collection_request(p_excluded_request_ids uuid[], p_lease_until timestamptz)`.
- Produces RPC `release_store_collection_request(p_request_id uuid, p_expected_lease_until timestamptz)`.
- Produces RPC `complete_store_collection_request(p_platform text, p_external_shop_id text, p_external_product_id text)`.
- Produces RPC `store_collection_queue_pending_count()`.

- [ ] **Step 1: Check current Supabase guidance and CLI capabilities**

Fetch `https://supabase.com/changelog.md`, inspect breaking changes relevant to Postgres/RLS/Data API, then run `supabase --version`, `supabase migration --help`, and the available database/advisor help before creating the migration.

- [ ] **Step 2: Write the failing migration contract test**

Assert both tables, unique store identity, unique product identity, FIFO indexes, lease predicates, RLS, revocation from `public/anon/authenticated`, service-role-only grants, batch input validation, idempotent upserts, tracked-product exclusion, and stale-lease-safe release.

- [ ] **Step 3: Run the migration test and verify failure**

Run: `node --test tests/store-collection-queue-migration.test.mjs`

Expected: FAIL because the generated migration has no schema yet.

- [ ] **Step 4: Implement the schema and RPCs**

Create `collection_stores` and `store_collection_requests`; use `timestamptz`, `check` constraints, a composite unique key `(platform, external_shop_id, external_product_id)`, partial FIFO index on pending/expired leases, `FOR UPDATE SKIP LOCKED` for claims, and `ON CONFLICT` for idempotent batches. Explicitly set `search_path`, revoke default function execution, and grant only to `service_role`.

- [ ] **Step 5: Validate locally and against a disposable transaction**

Run the focused test, apply SQL with the available Supabase SQL interface inside a transaction where possible, exercise begin → duplicate batch → claim → stale release rejection → valid release → completion, and roll back the disposable rows.

- [ ] **Step 6: Run database advisors**

Run the available Supabase database security and performance advisors. Resolve new warnings attributable to these tables/functions before continuing.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/*_store_collection_queue.sql tests/store-collection-queue-migration.test.mjs
git commit -m "feat: add private store collection queue"
```

### Task 3: Private saved-store import API

**Files:**
- Create: `api/admin-store-import.js`
- Create: `tests/admin-store-import-api.test.mjs`

**Interfaces:**
- Consumes the Task 2 RPCs.
- Produces POST actions `list`, `begin`, `batch`, `finish`, and `fail` at `/api/admin-store-import?action=<action>`.
- Returns saved stores as `{ id, storeKey, storeUrl, displayName, firstAddedAt, lastScanStartedAt, lastScanFinishedAt, lastScanStatus, discovered, newlyQueued, duplicate, alreadyTracked }`.

- [ ] **Step 1: Write failing API tests**

Mock `fetch` and cover timing-safe bearer authentication, POST-only behavior, 512 KB limit, normalized store input, valid UUID scan IDs, maximum batch length, numeric identities only, response mapping, and Supabase error handling without credential leakage.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/admin-store-import-api.test.mjs`

Expected: FAIL because the API module does not exist.

- [ ] **Step 3: Implement the API**

Reuse the admin authentication/header conventions from `api/admin-pc-collector.js`. Keep the Supabase service key server-only, map every action to one RPC or private table read, set `Cache-Control: no-store`, and return explicit 400/401/405/413/502 responses.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/admin-store-import-api.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/admin-store-import.js tests/admin-store-import-api.test.mjs
git commit -m "feat: add private store import API"
```

### Task 4: Extension store scanner

**Files:**
- Create: `extension/store-scanner.js`
- Create: `tests/extension-store-scanner.test.mjs`

**Interfaces:**
- Consumes a runtime message `{ type: "startStoreScan", scanId, storeUrl }`.
- Produces runtime messages `{ type: "storeScanProgress", scanId, products }` and `{ type: "storeScanFinished", scanId, status, discovered }`.
- Exposes pure test hooks under `globalThis.PriceTrackStoreScanner` for identity extraction and stop-condition calculation.

- [ ] **Step 1: Write failing scanner tests**

Use fixture HTML/objects for `-i.<shop>.<item>` and `/product/<shop>/<item>` links, duplicates, unrelated links, lazy additions, stable-scroll rounds, maximum duration, maximum identities, manual verification pause, and incomplete status.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/extension-store-scanner.test.mjs`

Expected: FAIL because the scanner script does not exist.

- [ ] **Step 3: Implement scanner discovery**

Scan anchors and captured listing payloads when available, normalize only numeric Shopee identities, emit bounded batches, scroll incrementally, stop after five stable rounds or safety limits, and never collect cookies, text content, customer data, or arbitrary URLs.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/extension-store-scanner.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/store-scanner.js tests/extension-store-scanner.test.mjs
git commit -m "feat: scan visible Shopee store products"
```

### Task 5: Extension admin bridge and scan coordinator

**Files:**
- Create: `extension/admin-collector-bridge.js`
- Modify: `extension/background.js`
- Modify: `extension/manifest.json`
- Create: `tests/extension-store-scan-bridge.test.mjs`

**Interfaces:**
- Admin page message: `{ source: "pricetrack-store-scan-page", type: "start", scanId, storeUrl }`.
- Extension page message: `{ source: "pricetrack-store-scan-extension", type: "ready|progress|finished|error", scanId, ... }`.
- Background session stores `adminTabId`, `storeTabId`, `scanId`, `storeUrl`, `startedAt`, and expires after ten minutes.

- [ ] **Step 1: Write failing bridge/coordinator tests**

Cover exact PriceTrack production origin/path, UUID and URL validation, one active scan per admin tab, store-tab creation/reuse, correct tab-directed progress, ten-minute expiry, stale/mismatched scan rejection, admin tab closure, and extension-ready handshake.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/extension-store-scan-bridge.test.mjs`

Expected: FAIL because bridge/session handling is absent.

- [ ] **Step 3: Implement the bridge and background session coordinator**

The admin content script accepts only same-window messages from `https://pricetrackph.com/admin/collector`, forwards validated commands through `chrome.runtime`, and posts returned progress to the page. The background worker creates or reuses one Shopee tab, routes commands by tab ID, rejects stale messages, and clears the session on completion/error/timeout.

- [ ] **Step 4: Register scripts and increment extension version**

Add `admin-collector-bridge.js` only for `https://pricetrackph.com/admin/collector*`; add `store-scanner.js` to Shopee content scripts after shared options; increment `extension/manifest.json` from `1.0.3` to the next patch version and update the extension README release note.

- [ ] **Step 5: Run focused tests and manifest validation**

Run: `node --test tests/extension-store-scan-bridge.test.mjs tests/extension-store-scanner.test.mjs`

Parse `extension/manifest.json` and run `node --check` on all extension JavaScript files.

- [ ] **Step 6: Commit**

```bash
git add extension/admin-collector-bridge.js extension/background.js extension/manifest.json extension/README.md tests/extension-store-scan-bridge.test.mjs
git commit -m "feat: coordinate private store scans in extension"
```

### Task 6: Collector API ordering and store lease handling

**Files:**
- Modify: `api/admin-pc-collector.js`
- Modify: `tests/admin-pc-collector-selection.test.mjs`

**Interfaces:**
- Produces `claimStoreProduct(supabaseUrl, secret, excludedRequestIds, leaseUntil)`.
- Changes `claimNextProduct(..., includeStoreImports)` to return `claimSource: "priority" | "store" | "random"`.
- Summary adds `storeQueuePending: number`.

- [ ] **Step 1: Add failing selection tests**

Cover summary count, priority-before-store, store-before-random, toggle-off bypass, empty-store fallback, malformed RPC result rejection, and stale-lease-safe store release.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/admin-pc-collector-selection.test.mjs`

Expected: FAIL on missing store claim behavior.

- [ ] **Step 3: Implement minimal collector integration**

Call the store pending-count RPC in summary; add atomic store claim and release helpers; parse `includeStoreImports === true` from the claim body; maintain separate attempted store request IDs or use a source-qualified request identity so public and store UUIDs cannot collide.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/admin-pc-collector-selection.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/admin-pc-collector.js tests/admin-pc-collector-selection.test.mjs
git commit -m "feat: prioritize enabled store imports in collector"
```

### Task 7: Admin collector saved-store UI and toggle

**Files:**
- Modify: `src/AdminCollector.tsx`
- Modify: `src/precision-fix.css`
- Modify: `tests/admin-collector-page.test.mjs`

**Interfaces:**
- Consumes Task 1 contract, Task 3 API, and Task 5 page messages.
- Adds localStorage key `pricetrack-admin-collector-include-store-imports` with default `true`.
- Sends `includeStoreImports` with every claim.

- [ ] **Step 1: Add failing UI source/behavior tests**

Assert the Store URL input, `Scan store`, default-on checkbox, saved-store rows, `Recheck`, last-scan date/totals, extension-required state, no automatic `startCollection()` call, `storeQueuePending`, disabled controls while running/scanning, and direct claim-body toggle.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/admin-collector-page.test.mjs tests/store-import-contract.test.mjs`

Expected: FAIL because the UI does not yet expose store imports.

- [ ] **Step 3: Implement scan state and extension handshake**

Generate a UUID, call API `begin`, post the validated start message, import progress batches through API `batch`, call `finish` or `fail`, refresh summary/saved stores, and show `Scan incomplete` without discarding accepted batches. Use a bounded timeout and remove message listeners during cleanup.

- [ ] **Step 4: Implement saved stores and Recheck**

Load stores beside summary/history, display normalized store label/URL and Philippine last-scan date, and have `Recheck` invoke the same scan function with the stored URL. Disable duplicate concurrent scan actions.

- [ ] **Step 5: Implement the collection toggle and status**

Default ON, persist in localStorage, disable during runs, send it directly in claim calls, show `Store queue pending`, and leave queued products untouched when OFF.

- [ ] **Step 6: Add responsive styling**

Match existing collector panels, preserve dark/light themes, provide visible focus states, stack controls on narrow screens, and keep the saved-store table horizontally scrollable.

- [ ] **Step 7: Run focused tests and build**

Run: `node --test tests/admin-collector-page.test.mjs tests/store-import-contract.test.mjs && npm run build`

Expected: all PASS and production build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/AdminCollector.tsx src/precision-fix.css tests/admin-collector-page.test.mjs
git commit -m "feat: add saved store scans to collector"
```

### Task 8: Complete store requests after successful recording

**Files:**
- Modify: `supabase/functions/record-price/index.ts`
- Modify: `tests/observation-policy.test.mjs`
- Create: `tests/store-queue-completion.test.mjs`

**Interfaces:**
- Consumes `complete_store_collection_request(text,text,text)` from Task 2.
- Completion happens only after the existing successful daily-check/observation transaction reaches its accepted outcome.

- [ ] **Step 1: Write failing completion tests**

Assert the store completion RPC is called for successful available, fully sold-out, and unchanged-price checks; is not called for invalid/failed submissions; and does not replace public-priority completion.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/observation-policy.test.mjs tests/store-queue-completion.test.mjs`

Expected: FAIL on missing store completion.

- [ ] **Step 3: Add store completion beside public completion**

Invoke both service-role RPCs with the same stable identity after successful recording. Handle completion idempotently; surface a logged completion warning without converting an already accepted product record into a client retry that could duplicate observations.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/observation-policy.test.mjs tests/store-queue-completion.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/record-price/index.ts tests/observation-policy.test.mjs tests/store-queue-completion.test.mjs
git commit -m "feat: complete store queue after recording"
```

### Task 9: Full regression and local end-to-end verification

**Files:**
- Modify only files required by failures attributable to this feature.

**Interfaces:**
- Validates the complete admin → extension → Shopee → API → Supabase → collector flow.

- [ ] **Step 1: Run all automated tests**

Run: `node --test tests/*.test.mjs`

Expected: all tests PASS.

- [ ] **Step 2: Run syntax and build verification**

Run `node --check` on extension and API JavaScript, then `npm run build`.

Expected: no syntax errors and build succeeds.

- [ ] **Step 3: Load the unpacked extension and run a controlled local scan**

Verify extension-ready detection, scan one small Shopee store, accepted progress batches, saved-store persistence, Recheck idempotency, toggle-off store bypass, and toggle-on priority → store → normal ordering. Do not use the 172-product Jabra store until the small scan succeeds.

- [ ] **Step 4: Verify concurrency and interruption**

Start two collector browser sessions against controlled requests. Confirm one lease per product, exact completion polling, safe release on Stop/tab closure, no duplicate queue rows, and only Remaining changes from live global state as previously approved.

- [ ] **Step 5: Review the diff against the specification**

Run `git diff <base>...HEAD --check` and inspect every changed file. Confirm no change to public quota, same-price/sold-out schedules, run limit, cooldown, unrelated pages, or service-key exposure.

### Task 10: Production migration, deployment, and live verification

**Files:**
- Deployment only; no unreviewed source edits.

**Interfaces:**
- Publishes the database functions, Edge Function change, website/API, and extension package in dependency order.

- [ ] **Step 1: Apply and verify the production migration**

Apply the reviewed migration to Supabase project `sgitojuhoaxxnujdikbd`; query table/function existence, RLS state, grants, indexes, empty pending count, and saved-store list. Run security/performance advisors and retain results.

- [ ] **Step 2: Deploy the record-price Edge Function**

Deploy the reviewed function, submit one controlled existing-product record, and confirm both queue-completion calls are idempotent and existing recording behavior remains successful.

- [ ] **Step 3: Merge and deploy the website/API**

Create the production PR, review checks, merge, and wait for Vercel deployment on project `prj_E2iaVctH5GVC4prog0AOdvZREdLG` to reach READY. Verify `/admin/collector`, authenticated summary/list calls, and unauthorized rejection.

- [ ] **Step 4: Package the extension update**

Create and integrity-check the updated extension ZIP. Verify version, manifest permissions, absence of secrets, and unchanged ordinary Shopee product recording. The live UI must show `Extension update required` until this version is installed.

- [ ] **Step 5: Run a small production store scan**

Confirm saved store creation, totals, no automatic collection, Recheck idempotency, queue pending count, and one collected product completion.

- [ ] **Step 6: Run the approved Jabra store scan**

Scan `https://shopee.ph/jabraofficialstore#product_list`, report visible discovered/new/duplicate/already-tracked totals, and do not describe Shopee's displayed 172 count as guaranteed available inventory.

- [ ] **Step 7: Final production verification**

Confirm toggle default ON, priority → store → normal ordering, 50-product stop, one-hour cooldown, saved store after browser restart, no duplicate scan imports, and green Vercel/Supabase health evidence before claiming completion.

---

## Self-review

- Spec coverage: admin scanning, saved stores, Recheck, queue persistence, ordering toggle, extension delivery, security, failure recovery, completion, concurrency, and production verification are each assigned to a task.
- Placeholder scan: no implementation step is deferred; the migration filename is intentionally generated by the required Supabase CLI command rather than invented.
- Type consistency: `includeStoreImports`, `storeQueuePending`, scan message names, saved-store response fields, claim sources, and RPC signatures are consistent across tasks.
