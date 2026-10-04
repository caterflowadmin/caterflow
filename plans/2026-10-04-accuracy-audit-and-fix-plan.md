# Accuracy audit and fix plan: everything outside the Reports page

Date: 2026-10-04 · Scope: all pages, API routes and libraries that compute or display stock, cost, sales, VAT or counts.

**How this was produced.** Source read of the dashboard, stock engine, stock APIs, procurement, purchases, receipts, dispatch, bin-count and low-stock code, plus a pattern search for the error classes already found on the Reports page. Nothing was run against live data.
Each finding is marked **Confirmed** (the faulty code was read and the failure follows from it) or **Verify** (a probable fault whose impact needs a data check first).

---

## 1. Summary

The Reports page was wrong for four reasons that exist elsewhere in the app too:

1. **Split data.** Documents older than 60 days live only in MongoDB; most code reads Sanity only, or reads the archive with a cap or an item-level bin requirement.
2. **Several stock calculators** that disagree with each other about which documents count.
3. **Moving valuation.** `StockItem.unitPrice` is overwritten by every receipt, so anything valued at it changes after the fact.
4. **Loose status and date handling.** Drafts counted, end-of-day boundaries, server time zone.

### Ranking

| Sev | Meaning | Count |
|-----|---------|-------|
| S1 | Can corrupt or erase stock data, or show wrong stock | 4 |
| S2 | Shows a wrong number to users | 9 |
| S3 | Latent, cosmetic or hardening | 6 |

**Fix first: F-01.** Running "emergency recalculate" or "initialize snapshots" today would rebuild stock from only the last 60 days of documents.

---

## 2. Findings

### S1: stock integrity

| ID | Where | Problem | Status |
|----|-------|---------|--------|
| F-01 | `api/stock/emergency-recalculate`, `api/stock-snapshots/initialize`, `api/stock/audit`, `admin/fix-stock` | These rebuild or audit stock from Sanity documents only. None reference the archive or stock baselines (0 mentions). Once documents older than 60 days are archived and deleted from Sanity, a recalculation zeroes the registry and `BinStock`, then replays only the last 60 days: stock is understated by everything received earlier. `initialize` also clamps with `Math.max(0, stock)`, which hides negative stock (it does filter by status). | **Confirmed** |
| F-02 | `lib/stockCalculations.ts` `calculateStockFromTransactions` (also `…Fixed`, `calculateStockForBin`, `calculateBulkStockFromTransactions`) | Four independent calculators. The one read matches receipts by document-level `receivingBin._ref` and dispatches by document-level `sourceBin._ref`. Current documents carry item-level bins (receipts) and `sourceSite` with optional item bins (dispatches), so new-format documents can be missed. Archived events are appended with no `_id` de-duplication against live events (double count while a document is in both stores). The `asOfDate` filter is not applied to archived events. | **Confirmed** (code read); impact **Verify** (which calculators are on the live path) |
| F-03 | `lib/archiveQueries.ts` `getArchivedTransactionsForItem` | Receipts match only when `receivedItems.receivingBin._id` equals the bin; dispatches only when `dispatchedItems.sourceBin._id` equals the bin. Archived legacy receipts (document-level bin) and dispatches without item bins are skipped, so archived history can contribute less stock movement than it should. | **Confirmed**; impact **Verify** |
| F-04 | `getStockAsOfDate`, `getStockHistory`, `getLowStockPredictions` | Sanity-only; no archive. "Stock as of date" and history older than 60 days are wrong or empty. | **Confirmed** (no archive reference) |

### S2: wrong numbers shown

| ID | Where | Problem | Status |
|----|-------|---------|--------|
| F-05 | `api/low-stock` GET | Queries `_type == "stockItem"` (the type is `StockItem`) on fields `quantity`/`bin` that `StockItem` does not have, so it always returns `[]`. The Reports Overview "Low Stock" and "Critical" KPIs read this endpoint and always show 0. | **Confirmed** |
| F-06 | `api/dashboard/stats` `calculateReceiptsTrend` | Previous-month count uses `receiptDate >= startOfPrevMonth` with no upper bound, so it includes the current month; `current − (previous + current)` is never positive and `Math.max(0, …)` hides it. The trend is always 0. | **Confirmed** |
| F-07 | `api/dashboard/stats` | "This month", "today" and "this week" use the server's time zone (UTC on Vercel, Eswatini is UTC+2): records 00:00–02:00 local land on the wrong day. Monthly receipt and dispatch counts include drafts and cancelled documents. "Out of stock" is `=== 0`, so negative stock is counted as low only. | **Confirmed** |
| F-08 | `api/procurement/requisition-summary` | `orderDate <= $endDate` with a bare `yyyy-MM-dd` end date drops every order timestamped later that day (the same defect fixed in `dateRangeUtils`). Default status filter is `approved` only, so received/processed orders vanish from "requisition" totals without saying so. | **Confirmed** |
| F-09 | `api/analytics/stock-values` | Inventory value = quantity × current `StockItem.unitPrice`. That price is overwritten on every receipt (F-10), so history re-values. Negative quantities reduce the total. Not scoped to the user's site and has no session check. It feeds the "live inventory" figure the Reports reconciliation compares against. | **Confirmed** |
| F-10 | `components/GoodsReceiptModal.tsx` (~652, ~1029) | On completion, `StockItem.unitPrice` is set to the latest received line price. There is no cost method (average, FIFO). Every report that falls back to the item price (count variances, transfers, live valuation) shifts whenever a price changes. | **Confirmed** |
| F-11 | `operations/receipts` page | Receipt total uses `item.totalPrice \|\| qty × unitPrice`. `totalPrice` can be stale if the received quantity was edited, so the page can disagree with Reports (qty × price). | **Verify** |
| F-12 | `components/DispatchModal.tsx` | Unit price on each dispatched item is user-editable and defaults to the item price (moving, F-10). Per-line totals are rounded to 2 dp and summed in the UI; the server recomputes from unrounded values, so printed and stored totals can differ by cents. Cost basis is not governed. | **Confirmed** |
| F-13 | Dashboard "Today's dispatches" | Counts dispatches with `status != "completed"`, so it is really "open dispatches today" while labelled as today's dispatches. | **Confirmed** (label vs query) |

### S3: latent and hardening

| ID | Where | Problem |
|----|-------|---------|
| F-14 | Currency labels | `E`, `SZL` and `$` mixed (`E {total.toFixed(2)}` in purchases/receipts/dispatches; count preview uses `$`); formats differ page to page. |
| F-15 | `api/stock-as-of-date` | Calls `fetch(NEXTAUTH_URL/api/stock-items)` server to server with no cookies (likely returns an auth error and an empty item list, giving value 0). Parses `key.split('-')`, which is only safe while item and bin ids contain no hyphen. No session check. |
| F-16 | `PurchaseOrder` totals in `purchases` page | `qty × unitPrice` re-summed in four places in the UI; the procurement page derives `unitPrice = totalPrice / qty`, so rounding drifts (100 / 3). |
| F-17 | `lib/unitPriceResolver` | `resolveUnitPrice` uses `??`, so a stored price of 0 (the receipt API persists `Number(x) \|\| 0`) is treated as a real price and the item price is not used. Reports uses `effectiveUnitPrice` (positive wins); the rest of the app does not. |
| F-18 | Dispatch PATCH routes | Re-fetch the selling price whenever the dispatch type or site is in the payload, so editing a draft re-stamps today's price. Acceptable before completion; should be frozen at completion. |
| F-19 | `api/dashboard/stats` cache | 30 s in-memory cache keyed by site ids only; per serverless instance, so counts can differ between requests and across users with the same sites. |

---

## 3. Root-cause classes (fix once, not per page)

| Class | Findings | Single fix |
|-------|----------|-----------|
| A. Split-brain Sanity/archive | F-01 F-02 F-03 F-04 | One `ledger` module that loads effective documents from both stores, de-duplicated and complete, used by every consumer |
| B. Multiple stock calculators | F-02 F-01 | One calculator with one definition of "effective document"; others deleted or made thin wrappers |
| C. Moving valuation | F-09 F-10 F-12 F-17 | Explicit cost policy (weighted average) with price captured on every document |
| D. Status semantics | F-06 F-07 F-11 F-13 | One `isEffective*` set (already in `lib/financialReport.ts`) used everywhere |
| E. Date boundaries and time zone | F-07 F-08 | Shared date-range helper plus one business time zone (Africa/Mbabane) |
| F. Wrong query / dead code | F-05 | Fix the query; add a contract test per endpoint |
| G. Presentation | F-14 F-16 | `formatSZL` everywhere; compute totals server-side once |
| H. Authorization | F-09 F-15 | Session and site scoping on every stock/value endpoint |

---

## 4. Which pages and numbers need recalculating

| Page / feature | Numbers affected | Root cause |
|----------------|------------------|-----------|
| Dashboard `/` | Receipts trend, monthly/today/weekly counts, out-of-stock count | F-06 F-07 F-13 |
| Reports → Overview KPIs | Low stock, critical stock (always 0) | F-05 |
| Reports → live-stock reconciliation | "Live inventory value" used as the comparison | F-09 F-10 |
| Current stock `/current`, Stock values API | Stock quantities if the registry is ever rebuilt; value column | F-01 F-02 F-09 |
| Low-stock `/low-stock` | Counts rely on the same calculators | F-02 |
| Admin → Fix stock, Emergency recalculate, Initialize snapshots, Audit | Whole stock registry | **F-01 (do not run until fixed)** |
| Procurement → Requisition summary | Totals and per-supplier/site amounts for ranges ending today | F-08 |
| Purchases, Procurement, Receipts | Totals; currency labels | F-11 F-14 F-16 |
| Dispatches, Dispatch modal, Actions | Cost per head, totals | F-12 F-17 |
| Stock history / "as of date" | Anything older than 60 days | F-04 F-15 |
| Bin counts | Variance values (valued at moving price); `systemQuantityAtCountTime` inherits any calculator error | F-02 F-10 |

---

## 5. Fix plan

### Phase 0: stop the bleeding (same day)

| Step | Action | Done when |
|------|--------|-----------|
| 0.1 | Guard `emergency-recalculate`, `stock-snapshots/initialize` and `admin/fix-stock`: refuse to run if any archive collection is non-empty, unless a baseline source is supplied; require admin and an explicit "I understand" body flag. | A request without the flag returns 409 with an explanation |
| 0.2 | Fix `api/low-stock` GET to use the same site-scoped calculation as its POST sibling (or return computed low-stock items). | Reports "Low Stock" KPI matches the `/low-stock` page |
| 0.3 | Fix the dashboard receipts trend (bounded previous-month range) and label "Today's open dispatches". | Unit test with fixed clock |
| 0.4 | Add session and site scoping to `analytics/stock-values` and `stock-as-of-date`. | Unauthenticated call returns 401 |

### Phase 1: single source of truth for documents (2–3 days)

1. **`lib/ledger.ts`**: `loadEffectiveDocs({siteId, from, to})` returning receipts, dispatches, transfers, counts from Sanity + archive, merged with `mergeById`, effective-status filtered, item-level bin resolved (item bin, then document bin, then `sourceSite`/PO site). It reuses `isEffective*` and `reportFilters`.
2. Replace the ad hoc `getArchivedTransactionsForItem` usage with the ledger (F-03), and add the archive to `getStockAsOfDate`, `getStockHistory`, predictions (F-04).
3. Contract tests: for a fixture with documents split across both stores (including legacy and new format), every consumer returns the same quantity.

### Phase 2: one stock calculator (3–4 days)

1. Define the semantics once: receipts add (status completed); dispatches subtract (evidence complete / status completed); transfers move; counts set the bin quantity at the count date.
2. Keep `calculateBulkStock` as the single public entry; implement it on the ledger; delete or wrap `calculateStockFromTransactions`, `…Fixed`, `calculateStockForBin`, `calculateBulkStockFromTransactions`, `calculateStockExactLogic`.
3. **Shadow mode first**: run old and new side by side per item/bin on every call for a week, log mismatches to a collection, then switch.
4. Rebuild `emergency-recalculate`, `initialize` and `audit` on the new calculator, with no clamping, and reporting negatives instead of hiding them.
5. Nightly invariant job: registry quantity equals calculator quantity; alert on any difference.

### Phase 3: valuation policy (2–3 days; needs a decision, see section 7)

1. Add weighted-average cost per item (and per site if desired), updated on each completed receipt and stored with an effective date. Stop overwriting `StockItem.unitPrice` with the last price; keep it as "standard/last purchase price" only.
2. Dispatch, transfer and count lines capture the average cost at the time. Make the dispatch unit price read-only (editable with a permission and reason).
3. `analytics/stock-values` and the Reports live figure use average cost.
4. Backfill: replay history once to produce cost layers; compare closing values month by month and record the deltas.

### Phase 4: statuses, dates, formatting (1–2 days)

1. Dashboard counts: effective documents only; month/day boundaries in Africa/Mbabane; use `parseDateRangeBoundary` for every user-supplied end date (fixes F-08, F-07).
2. Requisition summary: explicit status selector with a visible "approved only" label, and a total across statuses.
3. One `formatSZL` (already in `lib/financialReport.ts`) replacing `E`/`$`/`SZL` variants; totals computed server-side for POs and receipts and returned, so the UI never re-sums (F-14 F-16).
4. `resolveUnitPrice` adopts the `effectiveUnitPrice` rule (F-17).

### Phase 5: verification and monitoring (ongoing, starts in Phase 1)

| Check | How |
|-------|-----|
| Ledger identity | `opening(next) = closing(prev)` per site, nightly, alert on drift (the Reports close feature already stores closes) |
| Calculator parity | Shadow-mode mismatch log must be empty before cut-over |
| Registry parity | Nightly invariant (Phase 2.5) |
| Endpoint contracts | One test per count/total endpoint with a frozen clock and a mixed-store fixture |
| Data audit script | `scripts/audit_accuracy.js` reporting: documents present in both stores; draft documents in effective windows; receipt lines priced 0; dispatches without selling price; negative stock by bin |

---

## 6. Order, dependencies and risk

```
Phase 0 ─┬─> Phase 1 ─> Phase 2 ─> Phase 3
         └─> Phase 4 (independent after 0.3)
Phase 5 runs alongside, starting once Phase 1 lands
```

| Risk | Mitigation |
|------|-----------|
| Calculator switch changes visible stock | Shadow mode; record every difference with the document that explains it; release only with sign-off |
| Backfilled costs change historical valuations | Do not rewrite stored documents; store layers separately and compare |
| Archive load time | Ledger loads by bin/item with indexes on `stockItem._id`, `receivingBin._id`, `dispatchDate`; add them in `ensureIndexes` |
| Recalculation tools used before F-01 is guarded | Phase 0.1 first; announce to admins not to use "fix stock" |

---

## 7. Decisions needed from Gee

1. **Cost method.** Weighted average (recommended) or keep "latest price"? This decides how stock is valued everywhere.
2. **Dispatch prices.** Make the unit price read-only (derived from average cost), or keep manual entry with an audit reason?
3. **Business time zone.** Confirm Africa/Mbabane (UTC+2) for all "today / this month" boundaries.
4. **Evidence-pending dispatches.** Count them as consumed/sales (stock does not move until evidence is complete) or exclude them as now?
5. **Is anyone using "Fix stock" / "Emergency recalculate" today?** If yes, I should check what was run since archiving began.

---

## 8. Not covered

Authentication and user management pages, file upload and attachment handling, the archive engine itself (its correctness is assumed here except where noted), and any numbers computed in Sanity Studio.
