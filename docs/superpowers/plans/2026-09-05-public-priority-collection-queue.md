# Public Priority Collection Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Queue valid untracked products requested by mobile users, process them oldest-first in the existing admin collector, and complete them when any PriceTrack Chrome extension records the product.

**Architecture:** A private Supabase queue and daily-quota RPC provide atomic FIFO enqueue, claim, release, and completion operations. A new public Vercel API accepts only validated mobile requests, while the existing admin bridge claims queued products before random due products and the existing `record-price` Edge Function completes matching requests. The React homepage changes only its untracked-mobile error path; the collector page adds only a pending-count line.

**Tech Stack:** React 19, TypeScript, Vite, Vercel Node functions, Supabase Postgres/PLpgSQL, Supabase Edge Functions/Deno, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-05-public-priority-collection-queue-design.md`

## Global Constraints

- Only mobile visitors may add untracked products to the queue; desktop Chrome, Edge, Brave, and other PC browsers retain the existing extension-install guidance and never enqueue.
- Limit each anonymous mobile device to 100 distinct new queue requests per `Asia/Manila` calendar day, resetting at 12:00 AM Philippine time.
- Process pending requests oldest first; duplicate requests keep their original position and do not consume quota twice.
- Add only `Priority queue pending: N` to the existing `/admin/collector` status box; do not add a page, queue list, links, user information, or management controls.
- Preserve product reports, Chrome extension collection, random fallback selection, daily deduplication, sold-out rules, 15-day rechecks, collection history, the 50-success stop, and the one-hour manual-restart countdown.
- Never expose raw device identifiers; store only a SHA-256 hash.

---

### Task 1: Private Queue and Daily Quota Database Contract

**Files:**
- Create: `supabase/migrations/20260907_public_collection_queue.sql`
- Create: `tests/public-collection-queue-migration.test.mjs`

**Interfaces:**
- Produces: `enqueue_public_collection_request(text,text,text,text,date) returns jsonb`
- Produces: `claim_oldest_public_collection_request(text[],timestamptz) returns table(request_id uuid,shop_id text,external_product_id text,product_url text,lease_until timestamptz)`
- Produces: `release_public_collection_request(uuid) returns void`
- Produces: `complete_public_collection_request(text,text,text) returns void`
- Produces: `public_collection_queue_pending_count() returns bigint`

- [ ] **Step 1: Write the failing migration contract tests**

Create assertions that require private queue/quota tables, service-role-only grants, FIFO ordering, the Manila request date, duplicate-before-quota handling, a 100-request ceiling, leases, and completion by Shopee identity:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20260907_public_collection_queue.sql", import.meta.url), "utf8");

test("creates a private FIFO public collection queue", () => {
  assert.match(sql, /create table public\.public_collection_requests/i);
  assert.match(sql, /unique \(platform, external_shop_id, external_product_id\)/i);
  assert.match(sql, /order by requested_at asc/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /revoke all .* from public, anon, authenticated/is);
});

test("enforces 100 distinct mobile requests per Manila day", () => {
  assert.match(sql, /public_collection_request_quotas/i);
  assert.match(sql, /p_requested_date/i);
  assert.match(sql, /request_count >= 100/i);
  assert.match(sql, /duplicate/i);
});
```

- [ ] **Step 2: Run the migration test and verify RED**

Run: `node --test tests/public-collection-queue-migration.test.mjs`

Expected: FAIL because `20260907_public_collection_queue.sql` does not exist.

- [ ] **Step 3: Implement the schema and atomic RPCs**

Create `public_collection_requests` with UUID identity, `platform`, external IDs, canonical URL, `requested_at`, `status`, `lease_until`, `attempt_count`, `completed_at`, and timestamps. Create `public_collection_request_quotas` keyed by `(requester_hash, requested_date)`.

The enqueue function must lock by product identity, return `{status:"duplicate"}` before incrementing quota for an existing pending/leased request, reject at 100 with `{status:"limit_reached"}`, and insert/reopen with `{status:"queued"}`. All tables and functions are revoked from `public`, `anon`, and `authenticated`; only `service_role` receives execution.

The FIFO claim query must use:

```sql
where status = 'pending'
  and (lease_until is null or lease_until < now())
  and request_id::text <> all(coalesce(p_excluded_request_ids, '{}'::text[]))
order by requested_at asc
limit 1
for update skip locked
```

Completion must match `platform + external_shop_id + external_product_id`, set `status='completed'`, clear the lease, and set `completed_at` without depending on which extension recorded it.

- [ ] **Step 4: Verify the migration contract**

Run: `node --test tests/public-collection-queue-migration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Apply the migration to a Supabase development branch and exercise real RPC behavior**

Execute literal fixtures for devices A and B and verify: requests 1–100 for A queue, request 101 returns `limit_reached`, B can queue, a duplicate does not increment A's quota, FIFO claim returns the oldest timestamp, release makes it claimable, and completion removes it from the pending count.

Expected SQL results: A quota `100`, B quota `1`, duplicate retains its original `requested_at`, and pending count decreases by one after completion.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260907_public_collection_queue.sql tests/public-collection-queue-migration.test.mjs
git commit -m "Add private public collection queue"
```

---

### Task 2: Mobile-Only Public Queue API

**Files:**
- Create: `api/public-collection-request.js`
- Create: `tests/public-collection-request-api.test.mjs`

**Interfaces:**
- Consumes: `enqueue_public_collection_request`
- Produces: `POST /api/public-collection-request` body `{shopId:string,productId:string,productUrl:string,deviceId:string}`
- Produces: `{status:"queued"|"duplicate"}` with HTTP 200, or `{status:"limit_reached",error:string}` with HTTP 429

- [ ] **Step 1: Write failing API behavior tests**

Use a minimal response recorder and injected global `fetch`. Test Android/iPhone mobile user agents, desktop Chrome/Edge/Brave rejection, UUID device validation, Shopee URL/ID matching, SHA-256 hashing, RPC payload shape, duplicate success, and limit copy.

```js
test("rejects desktop requests without calling Supabase", async () => {
  global.fetch = async () => { throw new Error("must not call"); };
  const response = createResponse();
  await handler({ method:"POST", headers:{"user-agent":desktopChrome}, body:validBody }, response);
  assert.equal(response.statusCode, 403);
});

test("queues a validated Android request with a hashed device id", async () => {
  global.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.match(payload.p_requester_hash, /^[a-f0-9]{64}$/);
    assert.equal(payload.p_requested_date, "2026-09-05");
    return okJson({ status:"queued" });
  };
  const response = createResponse();
  await handler(androidRequest(validBody), response);
  assert.equal(response.statusCode, 200);
});
```

- [ ] **Step 2: Run the API tests and verify RED**

Run: `node --test tests/public-collection-request-api.test.mjs`

Expected: FAIL because the API module does not exist.

- [ ] **Step 3: Implement the API**

Accept POST only and cap the body using the same defensive pattern as existing APIs. Determine mobile context from `sec-ch-ua-mobile: ?1` or an Android/iPhone/iPad/Mobile user agent; reject desktop before any database call. Validate UUID v4, numeric IDs, HTTPS `shopee.ph`, and URL identity. Hash `deviceId` using Node SHA-256. Derive the request date with `Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Manila",...})`, call the service-role RPC, and map exact messages:

```js
const queuedMessage = "This product hasn't been tracked yet. It has been added to the PriceTrack collection queue and will be checked soon.";
const limitMessage = "You've reached today's 100-product request limit. You can request more products tomorrow.";
```

- [ ] **Step 4: Run API tests**

Run: `node --test tests/public-collection-request-api.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/public-collection-request.js tests/public-collection-request-api.test.mjs
git commit -m "Add mobile collection request endpoint"
```

---

### Task 3: Homepage Mobile Queue Submission and Desktop Preservation

**Files:**
- Create: `src/public-collection-request.ts`
- Modify: `src/App.tsx`
- Create: `tests/public-collection-request-client.test.mjs`
- Modify: `tests/find-product-by-title.test.mjs`

**Interfaces:**
- Produces: `isMobileVisitor(): boolean`
- Produces: `getPublicRequestDeviceId(): string`
- Produces: `requestUntrackedProduct(ids:{shopId:string;productId:string}): Promise<string>`
- Consumes: `POST /api/public-collection-request`

- [ ] **Step 1: Write failing client-policy tests**

Test mobile detection using `navigator.userAgentData.mobile` first and mobile user-agent fallback, stable local-storage UUID creation, canonical URL generation, returned queue message, and 429 message propagation.

```js
test("desktop visitors retain extension guidance and never request the queue", async () => {
  assert.equal(isMobileUserAgent(desktopChrome, false), false);
});

test("mobile short and full links use the same resolved identity", () => {
  assert.equal(canonicalShopeeUrl("448087759", "49650774952"),
    "https://shopee.ph/product/448087759/49650774952");
});
```

- [ ] **Step 2: Run the client tests and verify RED**

Run: `node --test tests/public-collection-request-client.test.mjs`

Expected: FAIL because `src/public-collection-request.ts` does not exist.

- [ ] **Step 3: Implement the focused client helper**

Store a UUID v4 under `pricetrack-public-request-device-id`. `requestUntrackedProduct` posts the resolved stable identity and canonical URL. Return server copy verbatim only for known responses; otherwise throw `Unable to add this product to the collection queue. Please try again.`

- [ ] **Step 4: Wire only the untracked submit path in `App.tsx`**

Add `UntrackedProductError` so `loadProduct` signals absence without matching message text. In `handleSubmit`, after `resolveProductQuery(query)`:

```ts
try {
  const found = await loadProduct(ids.shopId, ids.productId);
  showPermanentProductUrl(found, "push");
} catch (cause) {
  if (!(cause instanceof UntrackedProductError) || !isMobileVisitor()) throw cause;
  setError(await requestUntrackedProduct(ids));
}
```

Desktop users continue receiving exactly:

```text
This product hasn't been tracked yet. Open it on a PC with the PriceTrack PH Chrome extension to record its first price and variations.
```

Do not enqueue initial permanent report routes, featured-product loading, title-only searches, tracked products, or invalid links.

- [ ] **Step 5: Run focused and existing lookup tests**

Run: `node --test tests/public-collection-request-client.test.mjs tests/find-product-by-title.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/public-collection-request.ts src/App.tsx tests/public-collection-request-client.test.mjs tests/find-product-by-title.test.mjs
git commit -m "Queue untracked mobile product searches"
```

---

### Task 4: Priority Claim, Release, Status, and Pending Summary

**Files:**
- Modify: `api/admin-pc-collector.js`
- Modify: `tests/admin-pc-collector-selection.test.mjs`

**Interfaces:**
- Produces: `claimPriorityProduct(supabaseUrl,secret,excludedRequestIds)`
- Produces unified claim `{claimSource:"priority"|"random",queueRequestId:string|null,productId:number|null,shopId:string,externalProductId:string,productUrl:string,leaseUntil:string}`
- Extends summary with `priorityPending:number`
- Extends release body with `{claimSource,queueRequestId,productId}`
- Extends status body to accept `{productId}` or `{shopId,externalProductId}`

- [ ] **Step 1: Add failing admin bridge tests**

Test that priority RPC is called first; random RPC is called only when priority returns no row; FIFO rows normalize without an internal product ID; summary returns `priorityPending`; release calls the queue RPC for priority and clears the product lease for random; external identity status finds a newly created product and its successful daily check.

```js
test("claims a queued product before random due products", async () => {
  const product = await claimNextProduct(url, secret, [], []);
  assert.equal(product.claimSource, "priority");
  assert.equal(product.queueRequestId, queueId);
  assert.equal(product.productId, null);
});
```

- [ ] **Step 2: Run the admin tests and verify RED**

Run: `node --test tests/admin-pc-collector-selection.test.mjs`

Expected: FAIL because priority interfaces are missing.

- [ ] **Step 3: Implement priority-first claiming and pending summary**

Add service-role RPC calls for claim/count/release. Keep `claimRandomProduct` unchanged as the fallback. For priority status, query `products` by platform/shop/product identity, then reuse the existing daily-success and sold-out/recheck lookup with the resolved internal ID.

- [ ] **Step 4: Run admin bridge tests**

Run: `node --test tests/admin-pc-collector-selection.test.mjs`

Expected: PASS, including all existing random selection/history assertions.

- [ ] **Step 5: Commit**

```bash
git add api/admin-pc-collector.js tests/admin-pc-collector-selection.test.mjs
git commit -m "Prioritize queued collector requests"
```

---

### Task 5: Existing Collector Page Integration

**Files:**
- Modify: `src/AdminCollector.tsx`
- Modify: `tests/admin-collector-page.test.mjs`

**Interfaces:**
- Consumes unified claim and `priorityPending`
- Tracks per-run `attemptedQueueRequestIds:Set<string>` separately from product IDs

- [ ] **Step 1: Add failing collector page contract tests**

Require the new summary field and exact status line, separate queue attempt IDs, priority-aware release/status bodies, and no queue table/list/page markup:

```js
assert.match(source, /priorityPending: number/);
assert.match(source, /Priority queue pending: \{summary\?\.priorityPending/);
assert.match(source, /attemptedQueueRequestIds/);
assert.doesNotMatch(source, /<th>Queued product<\/th>|Queue management/);
```

- [ ] **Step 2: Run the page test and verify RED**

Run: `node --test tests/admin-collector-page.test.mjs`

Expected: FAIL because the pending count and priority claim fields are missing.

- [ ] **Step 3: Update the collector page**

Extend `CollectorSummary` and `CollectorProduct`; send both attempted ID sets when claiming. Poll priority products by external identity, release by queue request ID, and refresh the summary after a priority completion so the displayed pending count decreases. Add exactly one status line:

```tsx
<span>Priority queue pending: {summary?.priorityPending ?? "—"}</span>
```

Do not modify the action buttons, history table, delay, 50-product threshold, cooldown, or other status lines.

- [ ] **Step 4: Run page and session-policy tests**

Run: `node --test tests/admin-collector-page.test.mjs tests/collector-session-policy.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/AdminCollector.tsx tests/admin-collector-page.test.mjs
git commit -m "Show and process priority queue in collector"
```

---

### Task 6: Complete Queue Requests From Every Successful Extension Record

**Files:**
- Modify: `supabase/functions/record-price/observation-policy.ts`
- Modify: `supabase/functions/record-price/index.ts`
- Modify: `tests/observation-policy.test.mjs`

**Interfaces:**
- Consumes: `complete_public_collection_request(platform,shopId,productId)`
- Produces: `shouldCompleteQueue(checkStatus:string,markSucceeded:boolean):boolean`

- [ ] **Step 1: Write the failing completion-policy test**

```js
test("completes a queued request only after a successful daily check", () => {
  assert.equal(shouldCompleteQueue("success", true), true);
  assert.equal(shouldCompleteQueue("partial", true), false);
  assert.equal(shouldCompleteQueue("success", false), false);
});
```

- [ ] **Step 2: Run the policy test and verify RED**

Run: `node --test tests/observation-policy.test.mjs`

Expected: FAIL because `shouldCompleteQueue` is not exported.

- [ ] **Step 3: Implement completion after `mark_product_check` succeeds**

After a successful `mark_product_check` response and only when `checkStatus === "success"`, call the service-role completion RPC with the normalized platform/shop/product identity. Log a sanitized diagnostic error if queue completion fails, but do not turn an already successful price recording into a client failure; expired/stale requests will be removed by the admin claim reconciliation path.

- [ ] **Step 4: Run policy tests**

Run: `node --test tests/observation-policy.test.mjs`

Expected: PASS, including sold-out metadata regression coverage.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/record-price/observation-policy.ts supabase/functions/record-price/index.ts tests/observation-policy.test.mjs
git commit -m "Complete queued requests after recording"
```

---

### Task 7: Full Regression, Production Migration, Deployment, and Verification

**Files:**
- Modify: `PROJECT_HISTORY.md`
- Modify only if generated schema requires it: `src/database.types.ts`

**Interfaces:**
- Consumes all prior tasks
- Produces the deployed mobile queue workflow and unchanged desktop/collector behavior

- [ ] **Step 1: Run the complete automated suite**

Run: `node --test tests/*.test.mjs`

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: TypeScript and Vite complete with exit code 0.

- [ ] **Step 3: Review the exact diff and scope**

Run:

```bash
git diff --check
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- src api supabase tests PROJECT_HISTORY.md
```

Confirm the diff contains only the queue migration/API/client integration, priority collector fields, recording completion, pending-count line, tests, and history entry.

- [ ] **Step 4: Apply the reviewed migration to production**

Apply `20260907_public_collection_queue.sql` through the Supabase migration API. Verify table/RPC grants and run read-only checks showing pending count `0` before public use.

- [ ] **Step 5: Deploy the updated `record-price` Edge Function**

Deploy `supabase/functions/record-price/index.ts` with `observation-policy.ts` using the function's existing `verify_jwt:false` setting because it retains its custom extension/internal-token authentication. Verify the new version reports `ACTIVE`.

- [ ] **Step 6: Publish to GitHub `main` and wait for Vercel production**

Publish reviewed commits without force-updating history. Verify the Vercel deployment for the final commit reaches `READY` and aliases include `pricetrackph.com`.

- [ ] **Step 7: Verify the production user stories**

Use controlled products and devices to verify:

1. Mobile untracked lookup queues once and shows the approved queue message.
2. Repeating it preserves position and quota.
3. Desktop Chrome/Edge/Brave untracked lookup shows extension guidance and does not alter pending count.
4. Admin page shows `Priority queue pending: 1` in the existing box and no new page/list.
5. Start collection opens that priority product before random products.
6. Recording it with a regular extension completes the request and changes pending count to `0`.
7. The same product is not claimed again that Philippine day.
8. A test device can make 100 distinct requests; request 101 receives the approved daily-limit message; the next Manila date accepts a request.
9. A 50-success run still stops, saves history, displays the one-hour countdown, and requires manual restart.

- [ ] **Step 8: Update project history and commit**

Add a September 5, 2026 entry describing mobile-only FIFO requests, 100-per-device Manila-day quota, extension-first completion, and the single pending-count line.

```bash
git add PROJECT_HISTORY.md src/database.types.ts
git commit -m "Document public priority collection queue"
```
