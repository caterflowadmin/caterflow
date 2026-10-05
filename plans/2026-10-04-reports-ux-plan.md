# Reports page: UI/UX improvement plan

Scope: `next-caterflow-by-synapse/src/app/reports/page.tsx` (about 5,700 lines, one component) and the data it loads.
Written from the two phone screenshots of the Financial Performance section and a read of the code.

Status key: **Done** = implemented and tested · **Later** = not built.

## Implementation status (all phases)

| Item | Status | Where |
|------|--------|-------|
| Financial summary, stock-movement statement, data-quality alerts | Done | `reports/FinancialSummary.tsx`, `lib/financialReport.ts` |
| Sticky period + site bar (bottom sheet), partial-period chip, "Updated HH:mm", load progress | Done | `reports/PeriodBar.tsx` |
| vs-previous-period chips | Done | `FinancialSummary`, `previousRange`, `percentChange` |
| Tabs: shorter labels, scrollable, lazy-mounted, deep links (`?tab=&from=&to=&site=`) | Done | `reports/page.tsx` |
| Toasts: success toast removed; missing-date toast replaced by an alert | Done | `page.tsx`, `computeFinancials` |
| Drill-down sheets behind every figure and fixable alert | Done | `reports/DrillDownDrawer.tsx`, `buildDrillRows` |
| Partial-failure banner, inline error card with retry, exports disabled on partial data | Done | `reports/DataStatus.tsx`, `page.tsx` |
| Accessibility: 44px targets, contrast-safe tones, ▲/▼ not colour-only, ARIA labels | Done | components above |
| Stale period bug: changing dates on cached data now recalculates | Done | `reprocess` in `page.tsx` |
| Latest-request-wins guard against slow earlier loads | Done | `loadSeqRef` in `page.tsx` |
| Server-side summary endpoint (~1 KB), used as the fast path | Done | `api/reports/financials` |
| Stale-while-revalidate cache for raw documents | Done (in-memory, 5 min) | `rawDataCache` in `page.tsx` |
| Code-split charts (recharts) and on-demand xlsx / file-saver | Done | `reports/charts.tsx`, dynamic imports |
| Split of `page.tsx` | Partly done: charts, constants, skeletons, types, filters, calculation, bar, drawers and controls extracted (page ~4,300 lines, was ~6,400; VAT helpers moved to `lib/reportVat.ts`); fetch/processing hook still inside the page | |
| Period close, opening-balance record, reopen with audit trail | Done | `api/reports/period-close`, `lib/periodClose.ts`, `lib/reportAnchors.ts`, `reports/PeriodControls.tsx` |
| Edited-after-close detection | Done | `computeFinancials` |
| Item-level reconciliation view | Done | `reports/ReconciliationPanel.tsx`, `buildReconciliation` |
| Export parity (data-quality block in workbooks) | Done | `buildIntegrityRows` |
| Role-based views and API enforcement | Done | `lib/reportAccess.ts`, route handlers |
| True lazy *fetching* per tab (Overview KPIs need POs, low stock and stock values, so only the Charts/Export tabs could defer, which they already do by mounting lazily),  saved views, scheduled summaries, anomaly flags, offline snapshot | Later | Section 7 |


> **Platform limits.** Sanity is capped at **25,000 documents** on CaterFlow's plan; MongoDB Atlas M0 at 512 MB and about 1 GB/week transfer. Period closes and opening balances are stored in MongoDB for this reason. See `plans/2026-10-04-accuracy-audit-and-fix-plan.md` section 0.

---

## 1. What is wrong today

### 1.1 Seen in the screenshots (phone, dark mode)

| # | Problem | Effect |
|---|---------|--------|
| 1 | Nine metrics stacked one per row, each ~200px tall. | One section needs about 9 screens of scrolling. The numbers that relate to each other (opening, received, consumed, closing) are never visible together. |
| 2 | All metrics are the same size and weight. | No hierarchy. Profit, sales and VAT, which people open the page for, look like "Opening Stock". |
| 3 | Money is shown with inconsistent precision (`117,101.361`, `1,137,069.51`, `-43,390.782`). | Looks like a bug. Eswatini currency has 2 decimals. |
| 4 | Negative number shown as `SZL -43,390.782`. | Sign sits between the currency and the figure; easy to misread. |
| 5 | A permanent green banner said "Accurate period accounting with VAT enabled". | It claimed accuracy regardless of the data. The numbers were visibly inconsistent, so it destroyed trust. |
| 6 | The sticky header and bottom nav take about 25% of the viewport. | Content window is small. |
| 7 | The success toast covers the bottom nav and content for 3s. | Blocks the very number the user just loaded. |
| 8 | No indication that the period is partial (1–4 Oct) or that the comparison with September is not like for like. | Misreadable trends. |
| 9 | No way to see why a number is what it is. | Users can only say "these numbers don't make sense". |

### 1.2 Seen in the code

- One 5,700-line component holds fetching, calculation, five tabs, charts and exports; every state change re-renders everything.
- Every API list (receipts, dispatches, counts, transfers, POs) is downloaded in full, then filtered in the browser. This is now a larger download because the archive no longer truncates at 500 records.
- `filterDataByDateRange` raises a toast per call when records lack a date, so one load can produce several stacked toasts.
- The old opening-stock routine wrote a `console.log` per receipt and per dispatch item (thousands of lines per load), which is slow on a phone.
- Charts are built with fixed pixel heights and no mobile variants.
- Exports (Excel/CSV/PDF) are built from the same in-memory structures, so a calculation bug appears in the export as well.

---

## 2. Principles

1. **Numbers must explain themselves.** Every headline figure has a one-tap path to the documents behind it.
2. **Distrust is a feature.** The page states what it excluded and what does not reconcile, instead of reassuring.
3. **Phone first.** The primary user is on a phone, in dark mode, on a slow connection.
4. **Hierarchy over uniformity.** Profit, sales, VAT first; supporting detail on demand.
5. **One source of truth.** The UI shows what `computeFinancials()` returns; it does no arithmetic of its own.

---

## 3. Phase 0: foundation

- **Financial summary rebuilt** (`reports/FinancialSummary.tsx`):
  - 2×2 headline grid (Sales, COGS, Gross profit, VAT payable/refundable) with compact figures (`SZL 3.17M`) and full precision on hover/long-press.
  - A "Stock movement" statement that reads top to bottom: opening, plus received, minus consumed, plus or minus variances and transfers, equals closing. A user can see that it adds up.
  - Data-quality alerts generated from real checks (negative opening, closing far from live inventory, unpriced lines, dispatches without a price, excluded drafts). The unconditional green banner is gone; a green banner now appears only when nothing is wrong.
  - "How this is calculated" collapsed into an accordion.
- **Consistent money formatting** (`formatSZL`: always 2 decimals, `-SZL 5,210.16`).
- **Calculation moved out of the component** into `lib/financialReport.ts` with unit tests; removed ~650 lines and the per-record logging from `page.tsx`.

Acceptance (met): no `console.log` per document; same inputs give the same outputs; figures formatted identically everywhere in this section.

---

## 4. Phase 1: layout, drill-down, states (done)

### 4.1 Layout and navigation (phone)

- **Sticky period bar** under the app header: `1–4 Oct 2026 · All sites ▾`. Tap opens a bottom sheet containing the date presets and the site picker. Today the filters sit inside the page body and scroll away.
- Show a **"Partial period"** chip when the end date is before the end of the month, and a **"vs previous"** delta chip under each headline number (comparison range already exists in state).
- Replace the horizontal tab row with a **segmented control or scrollable chips** (Overview, Procurement, Dispatch, Inventory, VAT). Keep the selected tab in the URL (`?tab=vat`) so refresh and sharing work.
- Move success toasts to the **top** and shorten them to 1.5s. Show a persistent **"Updated 20:24 · all sites"** line instead, with a refresh button.
- Reduce chart heights to 220px on `base` and render legends below the chart, not beside it.

### 4.2 Drill-down ("why is this number this")

- Tapping a headline number or a Stock-movement row opens a **bottom sheet / drawer** listing the contributing documents (number, date, site, value), sorted by value, with search.
- The "excluded documents" note links to the same list filtered to the excluded set.
- Tapping an alert shows the affected documents (for example, the unpriced receipt lines).

### 4.3 States

| State | Today | Target |
|-------|-------|--------|
| Loading | Generic skeletons, no progress | Skeleton that matches the final layout; show "Loading receipts (1/5)…" because archive loads can take seconds |
| Partial failure | `Promise.allSettled` swallows failures and substitutes `[]` | Show a **warning banner naming the failed source** ("Dispatches failed to load; figures are incomplete") and disable export |
| Empty period | Zeros | "No completed receipts or dispatches in this period" with a suggestion to widen the range |
| Error | Toast | Inline error card with Retry |

The partial-failure state matters most: a failed dispatch fetch currently yields plausible-looking zeros.

### 4.4 Accessibility

- Contrast: the red VAT figure on dark background is about 3.6:1; use `red.300` in dark mode.
- Do not rely on colour alone for profit/loss: add ▲/▼ or "loss" text.
- Hit targets at least 44px for filter chips and drill-down rows.
- Alerts use `role="alert"` for critical and `role="status"` for info (Chakra does this by default; verify after any custom wrapper).

---

## 5. Phase 2: structure and performance (done, except full lazy fetching)

1. **Split `page.tsx`** into `ReportsShell` (filters, tabs), one component per tab, and a `useReportData()` hook that owns fetching and returns `{ status, data, errors }`. Memoise tab bodies so switching tabs does not recompute the others.
2. **Server-side financial summary.** Add `GET /api/reports/financials?start&end&site` that runs `computeFinancials` next to the data (Sanity + Mongo) and returns about 1 KB, not the full history.
   - Pre-aggregate month-end closing stock into a `stock_ledger_monthly` collection in the archive DB. Opening stock then becomes one lookup plus the current month's documents.
   - This removes the large-download problem introduced by lifting the 500 cap. Do it before archive volume grows further.
3. **Lazy tabs.** Fetch procurement, supplier and user data only when its tab opens.
4. **Cache.** `stale-while-revalidate` per (range, site) key, so reopening the page is instant.
5. **Batch the missing-date warning** into one toast per load (or move it into the integrity alerts).
6. **Charts:** lazy-load `recharts` per tab (it is a large part of the bundle) and downsample series to at most about 60 points.

Acceptance: first meaningful paint of the summary under 2s on a throttled 4G profile; payload for the summary under 50 KB.

---

## 6. Phase 3: trust and workflow (done)

- **Period close.** A "Close period" action stores the closing stock for a month. The next month's opening is read from it, and a changed closed period raises an alert ("a document dated in September was edited after close"). This is the durable fix for opening-stock drift.
- **Opening-balance record.** If there was stock before the first receipt in the system, record it once as a dated opening-balance entry so the ledger starts from the truth.
- **Reconciliation view.** A table of items with calculated stock vs live stock vs last count, sorted by gap, so the largest discrepancies are fixed first.
- **Export parity.** Exports read `computeFinancials()` output and include the integrity findings and exclusion counts as a header block, so a spreadsheet can never disagree with the screen.
- **Role-based view.** Site managers see their site only and a simplified summary (Sales, COGS, Closing stock); finance sees VAT and the reconciliation.

---

## 7. Later

- Saved views ("Mbabane, this month") and scheduled PDF/WhatsApp summary.
- Per-person unit economics trend (sales per head, cost per head by dispatch type) to spot price or portion drift. The 18.18 → 21.68 jump in the screenshots would have been caught by this.
- Anomaly flags on individual documents (price 5× the item average, quantity outliers).
- Offline snapshot of the last loaded summary for poor connectivity.

---

## 8. Test plan

| Layer | What |
|-------|------|
| Unit | `financialReport.test.ts` (ledger identity, filters, dedupe, VAT, pricing); `archiveQueries.test.ts` (no 500 cap) |
| Component | `FinancialSummary.test.tsx` (formatting, alert rendering); add drill-down sheet and period bar |
| E2E (Playwright) | Phone viewport 390×844, dark mode: load page → headline numbers visible without scrolling → open drill-down → change site → partial-failure banner when an API is mocked to 500 |
| Visual | Screenshot snapshots for light/dark × phone/desktop |
| Data | A fixture of 3 months of synthetic documents asserting opening(month n+1) equals closing(month n) |

## 9. Success measures

- Time to find "gross profit this month" on a phone: under 5s (from about 30s of scrolling).
- Support questions of the form "numbers don't match": zero, because each mismatch is now explained on screen.
- Summary payload and time-to-render per Phase 2 acceptance criteria.
