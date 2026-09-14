# Feature 1 Collector Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Feature 1 queue, recovery, scheduling, metrics, realtime history, verification alert, fast mode, and Store Scanner cleanup as one compatible release.

**Architecture:** Put deterministic queue/retry/state decisions in small shared modules, keep Supabase responsible for atomic claims and schedules, and keep React responsible for one local run plus realtime history. Extend the existing extension bridge with explicit result and verification messages rather than inferring every outcome from polling.

**Tech Stack:** React 19, TypeScript, Vite, Node/Vercel Functions, Chrome Manifest V3, Supabase Postgres/Realtime.

**Spec:** `docs/superpowers/specs/2026-09-14-feature-1-collector-orchestration-design.md`

## Global Constraints

- Asia/Manila is the calendar boundary for daily metrics.
- Normal browsing behavior and existing price/variation recording remain unchanged.
- Admin Collector and Store Scanner traffic never increments customer product opens.
- Database migrations deploy before dependent production code.
- Every behavior change follows a red-green regression cycle.

---

### Task 1: Deterministic queue cadence and remaining totals

**Files:**
- Create: `src/collector-queue-policy.ts`
- Modify: `src/AdminCollector.tsx`
- Modify: `api/admin-pc-collector.js`
- Create: `supabase/migrations/20260914_feature_1_queue_policy.sql`
- Test: `tests/feature-1-queue-policy.test.mjs`

**Interfaces:**
- Produces `nextNonPrioritySource(cadenceIndex): "store" | "normal"` and API claim input `preferredSource`.
- Produces atomic source-specific leased claims and a deduplicated remaining summary.

- [ ] Write tests proving Priority drains first and the non-priority sequence is Store, Normal, Normal.
- [ ] Run the focused test and verify the missing policy fails.
- [ ] Implement the policy and source-aware API/database claims.
- [ ] Run focused queue, migration, and existing claim tests.
- [ ] Commit the checkpoint.

### Task 2: Unavailable outcomes and scheduled retries

**Files:**
- Create: `extension/product-page-outcome.js`
- Modify: `extension/content.js`
- Modify: `extension/admin-collector-bridge.js`
- Modify: `api/admin-pc-collector.js`
- Create: `supabase/migrations/20260914_feature_1_unavailable_schedule.sql`
- Test: `tests/feature-1-product-outcomes.test.mjs`

**Interfaces:**
- Produces terminal outcomes `available`, `sold_out`, `unlisted`, `does_not_exist`, `page_error`, and `verification`.
- Database completion receives `outcome` and updates consecutive error/unavailable counters plus `next_check_at`.

- [ ] Write tests for terminal unavailable detection and first-page-error retry placement.
- [ ] Verify the tests fail on the current infinite-polling behavior.
- [ ] Implement outcome messages and 15-day/30-day schedules with recovery reset.
- [ ] Run outcome, observation, sold-out, and queue tests.
- [ ] Commit the checkpoint.

### Task 3: Graceful stop, API retry, and accurate finalization

**Files:**
- Create: `src/collector-request-policy.ts`
- Modify: `src/collector-run-recovery.ts`
- Modify: `src/AdminCollector.tsx`
- Modify: `api/admin-pc-collector.js`
- Test: `tests/feature-1-run-recovery.test.mjs`

**Interfaces:**
- Produces `withCollectorRetry(operation, policy)` and checkpoint states `running` or `pending_finalization`.
- Stop waits for active acknowledgement before finalization; transient failures do not become Interrupted.

- [ ] Write tests for bounded transient retries, active-product graceful stop, and pending finalization recovery.
- [ ] Verify each regression fails against the baseline.
- [ ] Implement retry/finalization without changing 401 login expiry behavior.
- [ ] Run focused and existing continuation/session tests.
- [ ] Commit the checkpoint.

### Task 4: Unlimited speed and Shopee verification alert

**Files:**
- Modify: `src/AdminCollector.tsx`
- Modify: `extension/content.js`
- Modify: `extension/admin-collector-bridge.js`
- Modify: `extension/background.js`
- Test: `tests/feature-1-fast-verification.test.mjs`

**Interfaces:**
- Unlimited mode omits only the post-product delay.
- Extension emits one verification transition and one cleared transition; the page pauses/resumes and background plays one notification.

- [ ] Write failing tests for zero unlimited delay, single alert per verification event, and automatic resume.
- [ ] Implement the minimal bridge/background/page state.
- [ ] Run extension and Collector regression tests.
- [ ] Commit the checkpoint.

### Task 5: Unique daily product opens and smart ranking inputs

**Files:**
- Modify: `extension/content.js`
- Modify: `supabase/functions/record-price/index.ts`
- Create: `supabase/migrations/20260914_feature_1_product_activity.sql`
- Modify: `api/admin-pc-collector.js`
- Test: `tests/feature-1-product-activity.test.mjs`

**Interfaces:**
- Observation metadata supplies collector mode and installation identity.
- Postgres upserts one daily open per product/installation/Manila date and exposes nullable ranking signals.

- [ ] Write failing tests for same-user deduplication, different-user counting, admin exclusion, and null metric ordering.
- [ ] Implement the activity table/RPC and ranked claim order using only available trusted fields.
- [ ] Run ingestion, policy, and migration regressions.
- [ ] Commit the checkpoint.

### Task 6: Realtime histories and retention

**Files:**
- Modify: `src/AdminCollector.tsx`
- Modify: `src/AdminHealth.tsx`
- Modify: `src/AdminStoreScanner.tsx`
- Create: `supabase/migrations/20260914_feature_1_history_realtime_retention.sql`
- Test: `tests/feature-1-history-realtime.test.mjs`

**Interfaces:**
- History tables subscribe to insert/update events and fetch the newest 20 entries.
- Retention removes entries older than 31 days; remote Collector events display for five seconds.

- [ ] Write failing tests for limit 20, scrolling, realtime subscription cleanup, transient remote notice, and 31-day cleanup.
- [ ] Implement shared realtime refresh behavior and secured cleanup.
- [ ] Run all admin page and migration tests.
- [ ] Commit the checkpoint.

### Task 7: Store Scanner cleanup and button styling

**Files:**
- Modify: `src/AdminStoreScanner.tsx`
- Modify: `src/styles.css`
- Test: `tests/feature-1-store-scanner-ui.test.mjs`

**Interfaces:**
- Successful completion clears the URL; incomplete/interrupted completion retains it.
- Scanner renders Pages scanned but no Current page card.

- [ ] Write failing UI tests for the two approved Store Scanner changes and scoped Collector button selectors.
- [ ] Sample and assert the exact approved active/disabled button colors from the supplied reference.
- [ ] Implement UI changes without changing scan transport.
- [ ] Run page tests and production build.
- [ ] Commit the checkpoint.

### Task 8: Full verification and atomic production release

**Files:**
- Modify only files required by failures found in verification.

**Interfaces:**
- Produces one reviewed commit on `main`, applied Supabase migrations, an extension package, and a READY Vercel production deployment.

- [ ] Run every Node test, TypeScript production build, extension syntax checks, and migration assertions.
- [ ] Review the full diff against the approved spec and confirm no unrelated work is included.
- [ ] Apply migrations to Product Tracking production and verify schema/advisors.
- [ ] Push the verified commit to GitHub `main` and verify its remote SHA.
- [ ] Verify Vercel production is READY and run post-deploy API/log checks.
- [ ] Package the matching extension build and report its version/checksum.
