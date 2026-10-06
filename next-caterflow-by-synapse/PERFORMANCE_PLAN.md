# Caterflow Performance Plan

Goal: every page paints useful content in under 1 second on a warm session, and no list/stat screen waits more than 2 seconds for data, regardless of how much history the system holds.

Status: PLAN ONLY. Nothing here has been implemented. Findings come from a code audit (no live profiling, no Sanity/Mongo credentials were available), so Phase 0 exists to turn the suspected causes into measured ones before any large change.

---

## 1. Root causes being addressed

| # | Cause | Evidence | Affects |
|---|-------|----------|---------|
| A | Client-side waterfall: JS → session → sites → data | 25 of 26 pages are `"use client"`; dashboard chains `useSession` → `/api/sanity` → `/api/dashboard/stats` | Every page |
| B | Unbounded list endpoints (Sanity + full Mongo archive merge) | `purchase-orders`, `goods-receipts`, `dispatches`, `bin-counts` GET; `ARCHIVE_NO_LIMIT = 0`; no Mongo indexes found | Purchases, Receipts, Dispatches, Bin Counts, Reports |
| C | Stock engine reads one giant `stockRegistry` doc per call and backfills missing item×bin pairs with 2 queries each, uncapped | `calculateBulkStock`, `calculateStockExactLogic` | Dashboard, Current Stock, Low Stock, Bin Counts, Reports |
| D | Dashboard stats = ~13 Sanity queries + full StockItem list + full stock calc per load | `api/dashboard/stats/route.ts` | Dashboard |
| E | No caching: `useCdn: false`, `no-store` on most routes, 30s per-instance LRU only | `lib/sanity.ts`, `lib/cache.ts` | All reads |
| F | Mongo cold-start connect + archive merge inside the critical path | `lib/mongoClient.ts` | List pages |
| G | Dereference-heavy GROQ filters (`bin->site._ref`) and per-row subqueries | activity, actions, dashboard counts, PO `hasReceipts` | Activity, Actions, Dashboard, Purchases |
| H | Noise and weight: ~565 `console.log`, 190–350 kB first-load JS, 4,000-line report pages | build output | All |

---

## 2. Phase 0 — Measure first (0.5–1 day)

Do not skip: it tells us which of A–H actually dominates in production.

1. Add a tiny server timing helper (`withTiming(name, fn)`) that logs duration per Sanity query / Mongo call, and emits a `Server-Timing` header on each API route.
2. Enable Vercel Speed Insights breakdown (already installed) and record TTFB/LCP/INP per route for a baseline.
3. Capture a baseline table: for each of the 26 pages, record time-to-first-content, time-to-data, number of requests, payload size. Save as `docs/perf-baseline.md`.
4. Confirm deployment topology: Vercel function region vs Sanity/Atlas region (a cross-region hop adds 100–300 ms to every query).
5. Check Atlas tier and connection count; check for existing indexes.
6. Measure registry document size (bytes) and number of item×bin pairs missing from it.

Exit criterion: top 5 slowest routes identified with numbers.

---

## 3. Phase 1 — Quick wins (1–2 days, low risk, no schema change)

| Task | Change | Files | Expected effect |
|------|--------|-------|-----------------|
| 1.1 | Remove debug `console.log` from hot paths (stock engine, siteFiltering, middleware, dashboard stats); gate the rest behind `LOG_LEVEL` | `lib/logger.ts` already exists — route logs through it | Less CPU/IO per request |
| 1.2 | Strip middleware logging and add `/api` to a lightweight auth matcher (see 1.6) | `middleware.ts` | Faster edge middleware |
| 1.3 | Dashboard: call `/api/dashboard/stats` directly; drop the `/api/sanity` site lookup by using `/api/sites` (already cached) or including sites in the stats response | `app/page.tsx` | Removes one serial round trip |
| 1.4 | Dashboard stats: compute `receiptsTrend` from one query returning both month counts; stop recomputing `countMonthlyReceipts`; run the trend inside the main `Promise.all` | `api/dashboard/stats/route.ts` | -2 sequential queries |
| 1.5 | Parallelise every `await` chain that has no dependency; cap fan-out in `calculateBulkStock` with a concurrency limiter (e.g. `p-limit` 8) | `stockCalculations.ts` | Prevents request storms |
| 1.6 | **Security + speed:** delete `/api/sanity`; add a shared `requireSession()` helper and apply to the 46 unauthenticated routes (exceptions: `auth/*`, health) | all `api/**/route.ts` | Closes open endpoints; unauthenticated traffic no longer reaches Sanity |
| 1.7 | Add `Cache-Control: private, max-age=30, stale-while-revalidate=120` to small lookup routes (sites, suppliers, locations, categories, dispatch-types, stock-items) and invalidate on their POST/PATCH/DELETE | those routes | Instant repeat navigation |
| 1.8 | Session: pass `session` to `SessionProvider` from the server layout (`getServerSession`) so the sidebar/nav never show the loading spinner | `layout.tsx`, `providers.tsx` | Removes the session round trip on first paint |
| 1.9 | Remove the legacy unused `AuthContext.tsx` fetch to `/api/auth/verify` if not mounted | `context/AuthContext.tsx` | Dead code removal |

Verification: re-run the baseline; `tsc`, `jest`, build must stay green.

---

## 4. Phase 2 — Fix the data layer (3–5 days, medium risk)

### 2.1 Paginate and window every list endpoint
- Add `?limit=&cursor=` (or `from`/`to` date range) to `purchase-orders`, `goods-receipts`, `dispatches`, `bin-counts`, `activity`, `transfers`, `approvals`.
- Default window: last 90 days, 50 rows per page, ordered by date. Return `{ items, nextCursor }`.
- Archived (Mongo) data is fetched **only** when the user asks for older records or searches; never merged by default.
- Detail views already exist (`/[id]`); list responses should return **summary projections** (no nested `orderedItems[]->{…}` unless the row is expanded).
- Frontend: infinite scroll / "Load older" button; keep Reports on the full dataset via its own aggregate endpoint (Section 2.4).

### 2.2 MongoDB
- Create indexes in a one-off script (`scripts/create_indexes.js`):
  - `{ dispatchDate: -1 }`, `{ "sourceSite._id": 1, dispatchDate: -1 }`
  - `{ orderDate: -1 }`, `{ "site._id": 1, orderDate: -1 }`, `{ status: 1, orderDate: -1 }`
  - `{ receiptDate: -1 }`, `{ "purchaseOrder.site._id": 1, receiptDate: -1 }`
  - `{ _sanityId: 1 }` (unique) on every archive collection
- Use projections on archive finds; set `allowDiskUse` off, `maxTimeMS` 4000.
- Warm the connection: export the client promise at module scope (already done) and call a cheap `ping` from a `/api/archive/health` cron every 5 min to keep instances warm.
- Confirm Atlas region == Vercel function region (`vercel.json` `regions`).

### 2.3 Stock engine redesign (largest single gain)
Current: one document holds every item×bin quantity and is fetched whole.
Plan, in order of ambition (pick one after Phase 0 numbers):

- **Option A (cheap):** keep the registry, but add a server-side in-memory cache of the parsed lookup `Map` (60s TTL, invalidated by `updateStockForTransaction`) instead of re-parsing JSON per call, and stop keying the cache on the full ID list (cache the registry, filter per request).
- **Option B (recommended):** move stock quantities to MongoDB (already provisioned) as one document per `{stockItemId, binId}` with an index on `binId` and `stockItemId`. Reads become indexed lookups of only the bins requested. Writes become single-doc `$inc`/`$set`, which also removes the registry write-contention and Sanity 4 MB document ceiling. Migration script `mongo:migrate` already exists as a pattern.
- **Option C:** per-bin registry documents in Sanity (smaller than A's single doc, no new datastore).
- In all options: replace the on-request backfill with a **background job** (cron or after-write hook). Requests treat missing pairs as 0 and flag `needsBackfill`, never fan out 2 queries per pair.

### 2.4 Pre-aggregated summaries
- Dashboard counts, low-stock counts, and report opening balances become **precomputed summary documents** updated on write (receipt/dispatch/transfer/count completion) or by a 5-minute cron. The dashboard reads one small document.
- `reports/financials` and `suggest-opening-balance`: cache results keyed by `(site, period, lastTransactionTimestamp)` in Mongo; recompute only when a newer transaction exists.

### 2.5 GROQ query hygiene
- Denormalise `siteId` onto GoodsReceipt, DispatchLog, InternalTransfer, InventoryCount, StockAdjustment at write time (backfill with a migration). Filters become `siteId in $siteIds` instead of `receivingBin->site._ref`, which Sanity can serve without joins.
- Replace per-order `count(*[GoodsReceipt…])` with a boolean `hasReceipts` field maintained at receipt completion.
- Use `[0...N]` limits and `order()` on indexed fields only.

### 2.6 Turn on caching for reads
- `useCdn: true` for the public read `client` on non-critical data (sites, suppliers, categories, dispatch types, stock-item catalogue). Keep `useCdn: false` for stock and transactions.
- Use Next `unstable_cache` / `revalidateTag` keyed by site and entity; call `revalidateTag` from the matching mutation routes.
- Use Sanity webhooks → `revalidateTag` so catalogue edits made in Studio appear immediately.

---

## 5. Phase 3 — Make pages feel instant (3–5 days)

### 3.1 Server-render the first paint
- Convert the shell and the list pages to server components that fetch the first page of data on the server and pass it as `initialData`; client component then hydrates and handles interaction. Order of conversion by traffic: Dashboard, Current Stock, Purchases, Receipts, Dispatches, Transfers, Actions, Approvals.
- Add `loading.tsx` with skeletons for every route segment so navigation shows structure immediately.

### 3.2 Client data layer
- Adopt **SWR or TanStack Query** (one dependency) for all fetches: request de-duplication, stale-while-revalidate, retry/backoff, and shared cache across pages (sites, bins, stock items are fetched by 6+ pages independently today).
- Prefetch on hover/focus for sidebar links (`router.prefetch` + `mutate` preload).
- Replace sequential fetches with parallel ones (`Promise.all`) and stream results into the UI as each arrives instead of one global spinner.
- Remove the global `setLoading(true)` on sidebar clicks in favour of Next's route transition (`useLinkStatus` / `loading.tsx`).

### 3.3 Optimistic UI
- Mutations (approve, status change, create PO, count entry) update the cache optimistically and reconcile on response; show inline row state, not a blocking spinner. `OptimisticLoading.tsx` already exists as a starting point.

### 3.4 Large-table rendering
- Virtualise tables over ~200 rows (`@tanstack/react-virtual`); debounce search (300 ms) and move filtering to the server for paged data.

### 3.5 Polling
- `useArchiveStatus` (60 s) and Admin Archive logs (15 s): pause when the tab is hidden (`visibilitychange`), back off when idle, and only mount on admin pages.

---

## 6. Phase 4 — Bundle and asset weight (2–3 days)

1. Dynamic-import heavy, rarely used code: `jspdf`, `jspdf-autotable`, `html2canvas`, `pdfkit` consumers, `file-saver`, export utilities, all modals (`next/dynamic`, `ssr: false` where client-only).
2. Split `reports/page.tsx` (4,325 lines) and `requisition-summary/page.tsx` (4,050) by tab/section, loading each tab's code on demand; same for `procurement`, `current`, `admin/archive`.
3. Tree-shake icons: import from specific `react-icons/*` subpackages (already `fi`, `bs` but audit duplicates), set `experimental.optimizePackageImports` for `@chakra-ui/react`, `react-icons`, `date-fns`, `framer-motion`.
4. Drop duplicate/unused deps: both `bcrypt` and `bcryptjs`; check `html2canvas`/`pdfkit`/`archiver` are only imported server-side or lazily.
5. Fonts: `Inter` via `next/font` is fine; add `display: 'swap'` and trim subsets/weights.
6. Run `@next/bundle-analyzer`; target shared first-load JS under 90 kB and no route above 220 kB.
7. Service worker: review `next-pwa` runtime caching so API routes use `NetworkFirst` with a short timeout and static assets are cache-first; make sure a stale SW cannot serve old JS after deploy (`skipWaiting` is on; verify update flow).

---

## 7. Phase 5 — Resilience and guardrails (ongoing)

- Per-route budgets in CI: a Playwright test that loads each page against seeded data and fails if requests > N or LCP > 2.5 s.
- Query timeouts: every Sanity/Mongo call wrapped with a timeout and a friendly partial-failure response (the page renders what it has, shows an inline retry for the failed card).
- Rate-limit expensive endpoints (`stock/emergency-recalculate`, `archive/*`, `reports/*`).
- Alerting: log slow routes (> 2 s) with route name and query timing; weekly review.
- Update `README.md` with performance conventions (pagination required for list routes, no unbounded `*[_type == ...]`, no `console.log` in hot paths).

---

## 8. Sequencing and effort

| Phase | Effort | Risk | Cumulative expected result |
|-------|--------|------|----------------------------|
| 0 Measure | 0.5–1 d | None | Baseline numbers |
| 1 Quick wins | 1–2 d | Low | Noticeably snappier navigation, dashboard 1–2 round trips faster, APIs locked down |
| 2 Data layer | 3–5 d | Medium (needs migration + backfill) | List pages and stock screens stop degrading with data volume |
| 3 Page feel | 3–5 d | Medium | First paint instant with skeletons, repeat visits near-instant |
| 4 Bundles | 2–3 d | Low | Faster cold loads, especially on mobile |
| 5 Guardrails | ongoing | Low | Prevents regression |

Suggested order: 0 → 1 → 2.1/2.2 → 2.3 → 3 → 2.4–2.6 → 4 → 5.

## 9. Targets

| Metric | Target |
|--------|--------|
| Dashboard time-to-data | < 1.5 s |
| List pages (first page of 50) | < 1.2 s |
| Current Stock (full site) | < 2 s |
| Navigation between visited pages | < 300 ms (cached) |
| First-load JS per route | < 220 kB |
| API p95 | < 1 s (lists), < 2 s (reports) |

## 10. Risks and rollback

- Stock engine migration is the riskiest change: run old and new paths in parallel behind a flag, compare outputs with the existing `validateStockConsistency` / audit routes, and cut over per site.
- `siteId` denormalisation needs a backfill and a write-path change; deploy write-path first, backfill second, switch queries third.
- Authentication lockdown may break any external integration or cron calling open endpoints — inventory callers first (cron routes already use `CRON_SECRET`).
- Each phase ships independently; keep the build green (`tsc`, 191 unit tests, e2e) before merging.

## 11. Open questions for the owner

1. Which Vercel region and Atlas region are in use today?
2. How many records exist per collection (Sanity vs Mongo archive), and how large is the stock registry document?
3. Is MongoDB acceptable as the new home for live stock quantities (Option B), or must Sanity remain the system of record?
4. Are any external systems calling the currently unauthenticated API routes?
5. Is the default 90-day window acceptable for list pages, with older data on request?
