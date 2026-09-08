# Design 1 Collector Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make collector runs recoverable, add independent same-price and sold-out deferral controls, and add an unlimited verification-safe collection mode.

**Architecture:** Keep an idempotent active-run checkpoint in browser local storage and convert it to one `Interrupted` history row on the next collector-page load. Pass both deferral choices through the collector URL, extension payload, Edge Function metadata, and database scheduling function; collection counts remain independent. Represent normal/unlimited collection as an explicit run mode and poll the claimed product until success or manual stop so verification can never advance the queue.

**Tech Stack:** React 19, TypeScript, Vite, Node test runner, browser extension JavaScript, Vercel Functions, Supabase Edge Functions/Postgres.

**Spec:** `/workspace/scratch/ff5c7a56a25f/Design-1-Interrupted-Collector-Recovery.md`

## Global Constraints

- Normal Start collection keeps the one-hour cooldown and 50-success limit.
- Unlimited collection has no cooldown and no product limit.
- Neither mode advances, fails, releases, or skips a product while its recording remains unresolved.
- Same-price and sold-out counts are always recorded, regardless of their deferral toggles.
- Existing database records remain authoritative and duplicate history rows are prevented by `run_id` upsert.

---

### Task 1: Collector settings and run modes

**Files:** Modify `src/admin-collector-settings.ts`, `src/collector-session-policy.ts`, `src/AdminCollector.tsx`; test `tests/admin-collector-page.test.mjs`.

- [ ] Add failing tests for the sold-out URL option, default-on toggle, unlimited start button, normal-only cap/cooldown, and indefinite exact-product polling.
- [ ] Run the focused tests and confirm failure.
- [ ] Implement the toggle and run-mode behavior.
- [ ] Run the focused tests and confirm success.

### Task 2: Extension and database scheduling contract

**Files:** Modify `extension/collector-options.js`, `extension/content.js`, `supabase/functions/record-price/index.ts`; create `supabase/migrations/20260908_optional_sold_out_skip.sql`; test `tests/unchanged-price-skip.test.mjs` and `tests/admin-pc-collector-selection.test.mjs`.

- [ ] Add failing tests proving counts are toggle-independent and sold-out deferral is conditional.
- [ ] Run focused tests and confirm failure.
- [ ] Pass `skipSoldOut` end-to-end and update `mark_product_check` scheduling.
- [ ] Run focused tests and confirm success.

### Task 3: Interrupted-run recovery

**Files:** Create `src/collector-run-recovery.ts`; modify `src/AdminCollector.tsx`, `api/admin-pc-collector.js`; create `supabase/migrations/20260908_collector_interrupted_status.sql`; test `tests/admin-collector-page.test.mjs` and `tests/admin-pc-collector-selection.test.mjs`.

- [ ] Add failing tests for checkpoint validation, progress persistence, one-time recovery, and `Interrupted` history mapping.
- [ ] Run focused tests and confirm failure.
- [ ] Implement synchronous browser checkpoints, recovery finalization, and idempotent backend status support.
- [ ] Run focused tests and confirm success.

### Task 4: Release verification and production deployment

**Files:** Update generated deployment artifacts only where required.

- [ ] Run the full Node test suite, TypeScript/Vite build, and syntax checks.
- [ ] Deploy the migration and Edge Function, then verify their live versions.
- [ ] publish the repository change through the connected GitHub/Vercel flow and verify the production deployment.
- [ ] Smoke-test the production collector page and API contract.
