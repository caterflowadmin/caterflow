// src/lib/financialReport.ts
// Pure, unit-tested financial calculations for the reports page.
//
// Extracted from reports/page.tsx so the numbers can be tested without
// rendering the page, and so opening/closing stock is continuous BY
// CONSTRUCTION:
//
//   closing(P)  = opening(P) + purchases(P) - consumption(P) + variances(P) + transfers(P)
//   opening(P)  = the same ledger summed over everything strictly before P.start
//
// Therefore opening(next period) === closing(this period) whenever the two
// periods are adjacent. The previous implementation anchored opening stock to
// "latest count per item" which broke that identity.

import { VAT_CONFIG } from "@/lib/vatConfig";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface IntegrityIssue {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
}

/**
 * A trusted starting point for the ledger: either a closed period (its stored
 * closing stock) or a one-off opening-balance entry. Documents dated before
 * `asOf` are covered by the anchor and are not re-summed.
 */
export interface LedgerAnchor {
  kind: "close" | "opening-balance";
  /** Ledger resumes at this instant (documents dated >= asOf are summed on top). */
  asOf: Date;
  /** Stock value at `asOf`. */
  value: number;
  /** When the anchor was recorded; documents edited after this and dated before `asOf` raise an alert. */
  recordedAt?: Date | null;
}

export interface FinancialInput {
  receipts: any[];
  dispatches: any[];
  counts: any[];
  transfers: any[];
  range: { start: Date; end: Date };
  /** Site the data is scoped to (null/"all" = every site). */
  siteId?: string | null;
  /**
   * Live sum(currentStock x unitPrice). Used for the reconciliation check and,
   * for an all-sites view with no closed period / opening balance, to estimate
   * the missing opening baseline (see `liveBaseline`).
   */
  liveInventoryValue?: number | null;
  /** "Now", injectable for tests. */
  now?: Date;
  /** Latest period close / opening balance at or before range.start. */
  anchor?: LedgerAnchor | null;
}

export interface FinancialResult {
  openingStock: number;
  periodPurchases: number;
  periodConsumption: number;
  netVariances: number;
  netTransfers: number;
  closingStock: number;
  /**
   * Estimated stock that existed before the first recorded document, derived
   * as live inventory minus the full document ledger. Already included in
   * `openingStock` and `closingStock`; 0 when not applied.
   */
  liveBaseline: number;
  periodSales: number;
  peopleFed: number;
  vatOnPurchases: number;
  vatOnSales: number;
  netVATPayable: number;
  grossProfit: number;
  profitPercentage: number;
  counts: {
    receipts: number;
    dispatches: number;
    binCounts: number;
    transfers: number;
  };
  excluded: {
    receipts: number;
    receiptsValue: number;
    dispatches: number;
    dispatchesCost: number;
    binCounts: number;
    transfers: number;
  };
  /** Anchor the opening stock was built from, if any. */
  anchoredOn: { kind: LedgerAnchor["kind"]; asOf: string } | null;
  integrity: IntegrityIssue[];
}

// ─── Small helpers ─────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const round2 = (v: number): number => Math.round(v * 100) / 100;

const timeOf = (v: unknown): number => {
  if (!v) return NaN;
  return new Date(v as string).getTime();
};

/**
 * Price used to value a quantity. A recorded line price wins; a missing OR
 * zero line price (the receipt API stores `Number(x) || 0`, so "missing" is
 * persisted as 0) falls back to the stock item's default price.
 */
export const effectiveUnitPrice = (
  linePrice: unknown,
  itemPrice: unknown,
): number => {
  const line = num(linePrice);
  if (line > 0) return line;
  return num(itemPrice);
};

/**
 * Merge two lists of documents keyed by `_id`. The first list wins on a clash
 * (Sanity is the live source of truth; the archive may still hold a copy of a
 * document that has not yet been deleted from Sanity).
 */
export function mergeById<T extends { _id?: string }>(
  primary: T[],
  secondary: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const doc of [...primary, ...secondary]) {
    const id = doc?._id;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(doc);
  }
  return out;
}

// ─── "Does this document actually move stock?" filters ─────────────────────────
// Documents with no status at all are legacy/archived records and are kept.

export const isEffectiveReceipt = (gr: any): boolean =>
  !gr?.status || gr.status === "completed";

export const isEffectiveDispatch = (d: any): boolean => {
  if (!d) return false;
  if (!d.status && !d.evidenceStatus) return true; // legacy
  return d.evidenceStatus === "complete" || d.status === "completed";
};

export const isEffectiveCount = (c: any): boolean =>
  !c?.status || c.status === "completed" || c.status === "adjusted";

export const isEffectiveTransfer = (t: any): boolean =>
  !t?.status || t.status === "completed";

// ─── Document valuation ────────────────────────────────────────────────────────

export const receiptValue = (gr: any): number =>
  (gr?.receivedItems || []).reduce(
    (sum: number, item: any) =>
      sum +
      num(item.receivedQuantity) *
        effectiveUnitPrice(item.unitPrice, item.stockItem?.unitPrice),
    0,
  );

/** Input VAT for a receipt. Items flagged `isVATApplicable === false` are zero-rated. */
export const receiptVAT = (gr: any): number =>
  (gr?.receivedItems || []).reduce((sum: number, item: any) => {
    const lineValue =
      num(item.receivedQuantity) *
      effectiveUnitPrice(item.unitPrice, item.stockItem?.unitPrice);
    const applicable = item.stockItem?.isVATApplicable !== false;
    return sum + VAT_CONFIG.calculateVAT(lineValue, applicable).vatAmount;
  }, 0);

export const dispatchCost = (d: any): number => {
  const stored = num(d?.totalCost);
  if (stored > 0) return stored;
  return (d?.dispatchedItems || []).reduce((sum: number, item: any) => {
    const line = num(item.totalCost);
    if (line > 0) return sum + line;
    return (
      sum +
      num(item.dispatchedQuantity) *
        effectiveUnitPrice(item.unitPrice, item.stockItem?.unitPrice)
    );
  }, 0);
};

/**
 * Selling price per person for a dispatch, in order of trust:
 *  1. the price stamped on the dispatch when it was created,
 *  2. the dispatch type's site-specific price for the dispatching site,
 *  3. the dispatch type's base price.
 */
export const dispatchSellingPrice = (d: any): number => {
  const stamped = num(d?.sellingPrice);
  if (stamped > 0) return stamped;
  const siteId = d?.sourceSite?._id;
  const sitePrices: any[] = d?.dispatchType?.sitePrices || [];
  if (siteId) {
    const match = sitePrices.find(
      (sp) => (sp?.site?._id || sp?.site) === siteId,
    );
    if (match && num(match.price) > 0) return num(match.price);
  }
  return num(d?.dispatchType?.sellingPrice);
};

/** Sales (VAT-exclusive). A stored `totalSales` is never overwritten. */
export const dispatchSales = (d: any): number => {
  const stored = num(d?.totalSales);
  if (stored > 0) return stored;
  return dispatchSellingPrice(d) * num(d?.peopleFed);
};

export const countVariance = (count: any): number =>
  (count?.countedItems || []).reduce((sum: number, item: any) => {
    if (typeof item.varianceCost === "number" && Number.isFinite(item.varianceCost)) {
      return sum + item.varianceCost;
    }
    let variance = item.variance;
    if (
      (variance === undefined || variance === null) &&
      typeof item.countedQuantity === "number" &&
      typeof item.systemQuantityAtCountTime === "number"
    ) {
      variance = item.countedQuantity - item.systemQuantityAtCountTime;
    }
    return (
      sum +
      num(variance) * effectiveUnitPrice(item.unitPrice, item.stockItem?.unitPrice)
    );
  }, 0);

/**
 * Net value effect of internal transfers on ONE site's stock (inflow positive,
 * outflow negative). Bin-to-bin moves within a site, and any "all sites" view,
 * net to zero.
 */
export const netTransferValue = (
  transfers: any[],
  siteId: string | null | undefined,
): number => {
  if (!siteId || siteId === "all" || !Array.isArray(transfers)) return 0;
  return transfers.reduce((sum: number, t: any) => {
    const fromSite = t.fromBin?.site?._id || t.fromBin?.site;
    const toSite = t.toBin?.site?._id || t.toBin?.site;
    const inflow = toSite === siteId;
    const outflow = fromSite === siteId;
    if (inflow === outflow) return sum;
    const items = t.items || t.transferredItems || [];
    const value = items.reduce(
      (s: number, item: any) =>
        s + num(item.transferredQuantity) * num(item.stockItem?.unitPrice),
      0,
    );
    return sum + (inflow ? value : -value);
  }, 0);
};

// ─── The ledger ────────────────────────────────────────────────────────────────

interface Ledger {
  purchases: number;
  consumption: number;
  variances: number;
  transfers: number;
}

const sumLedger = (
  receipts: any[],
  dispatches: any[],
  counts: any[],
  transfers: any[],
  siteId: string | null | undefined,
): Ledger => ({
  purchases: receipts.reduce((s, gr) => s + receiptValue(gr), 0),
  consumption: dispatches.reduce((s, d) => s + dispatchCost(d), 0),
  variances: counts.reduce((s, c) => s + countVariance(c), 0),
  transfers: netTransferValue(transfers, siteId),
});

const inRange = (value: unknown, start: Date, end: Date): boolean => {
  const t = timeOf(value);
  return Number.isFinite(t) && t >= start.getTime() && t <= end.getTime();
};

const before = (value: unknown, start: Date): boolean => {
  const t = timeOf(value);
  return Number.isFinite(t) && t < start.getTime();
};

// ─── Main entry point ──────────────────────────────────────────────────────────

export function computeFinancials(input: FinancialInput): FinancialResult {
  const { range, siteId = null } = input;
  const now = input.now ?? new Date();

  const receiptsAll = mergeById(input.receipts || [], []);
  const dispatchesAll = mergeById(input.dispatches || [], []);
  const countsAll = mergeById(input.counts || [], []);
  const transfersAll = mergeById(input.transfers || [], []);

  const receipts = receiptsAll.filter(isEffectiveReceipt);
  const dispatches = dispatchesAll.filter(isEffectiveDispatch);
  const counts = countsAll.filter(isEffectiveCount);
  const transfers = transfersAll.filter(isEffectiveTransfer);

  // ── Opening: anchor value (if any) + everything between the anchor and the period start ──
  const anchor =
    input.anchor && input.anchor.asOf.getTime() <= range.start.getTime()
      ? input.anchor
      : null;
  const anchorMs = anchor ? anchor.asOf.getTime() : -Infinity;
  const afterAnchor = (value: unknown): boolean => {
    const t = timeOf(value);
    return Number.isFinite(t) && t >= anchorMs;
  };
  const opening = sumLedger(
    receipts.filter(
      (r) =>
        before(r.receiptDate ?? r.createdAt, range.start) &&
        afterAnchor(r.receiptDate ?? r.createdAt),
    ),
    dispatches.filter(
      (d) =>
        before(d.dispatchDate ?? d.createdAt, range.start) &&
        afterAnchor(d.dispatchDate ?? d.createdAt),
    ),
    counts.filter(
      (c) =>
        before(c.countDate ?? c.createdAt, range.start) &&
        afterAnchor(c.countDate ?? c.createdAt),
    ),
    transfers.filter(
      (t) =>
        before(t.transferDate ?? t.createdAt, range.start) &&
        afterAnchor(t.transferDate ?? t.createdAt),
    ),
    siteId,
  );

  // ── Baseline estimate ──
  // With no trusted anchor, the ledger starts from zero and so ignores any
  // stock that existed before the first recorded document. Live inventory is
  // the physical record, so the shortfall between it and the full ledger (all
  // effective documents up to now) is the missing baseline. Adding the same
  // constant to every period keeps opening(next) === closing(this) intact and
  // makes the ledger land on live stock today. It is surfaced as an explicit
  // estimate, never silently clamped.
  const liveValue = input.liveInventoryValue;
  const allSites = !siteId || siteId === "all";
  let liveBaseline = 0;
  if (
    !anchor &&
    allSites &&
    typeof liveValue === "number" &&
    Number.isFinite(liveValue) &&
    liveValue > 0
  ) {
    const nowMs = now.getTime();
    const upToNow = (value: unknown): boolean => {
      const t = timeOf(value);
      return Number.isFinite(t) && t <= nowMs;
    };
    const toNow = sumLedger(
      receipts.filter((r) => upToNow(r.receiptDate ?? r.createdAt)),
      dispatches.filter((d) => upToNow(d.dispatchDate ?? d.createdAt)),
      counts.filter((c) => upToNow(c.countDate ?? c.createdAt)),
      transfers.filter((t) => upToNow(t.transferDate ?? t.createdAt)),
      siteId,
    );
    liveBaseline = round2(
      liveValue -
        (toNow.purchases - toNow.consumption + toNow.variances + toNow.transfers),
    );
  }

  const openingStock =
    liveBaseline +
    (anchor ? anchor.value : 0) +
    opening.purchases -
    opening.consumption +
    opening.variances +
    opening.transfers;

  // ── Period ──
  const periodReceipts = receipts.filter((r) =>
    inRange(r.receiptDate ?? r.createdAt, range.start, range.end),
  );
  const periodDispatches = dispatches.filter((d) =>
    inRange(d.dispatchDate ?? d.createdAt, range.start, range.end),
  );
  const periodCounts = counts.filter((c) =>
    inRange(c.countDate ?? c.createdAt, range.start, range.end),
  );
  const periodTransfers = transfers.filter((t) =>
    inRange(t.transferDate ?? t.createdAt, range.start, range.end),
  );
  const period = sumLedger(
    periodReceipts,
    periodDispatches,
    periodCounts,
    periodTransfers,
    siteId,
  );

  const closingStock =
    openingStock +
    period.purchases -
    period.consumption +
    period.variances +
    period.transfers;

  // ── Sales / VAT / profit ──
  const periodSales = periodDispatches.reduce((s, d) => s + dispatchSales(d), 0);
  const peopleFed = periodDispatches.reduce((s, d) => s + num(d.peopleFed), 0);
  const vatOnPurchases = round2(
    periodReceipts.reduce((s, gr) => s + receiptVAT(gr), 0),
  );
  const vatOnSales = VAT_CONFIG.calculateVAT(periodSales, true).vatAmount;
  const netVATPayable = round2(vatOnSales - vatOnPurchases);
  const grossProfit = periodSales - period.consumption;
  const profitPercentage = periodSales > 0 ? (grossProfit / periodSales) * 100 : 0;

  // ── Exclusions (documents that exist but do not move stock) ──
  const excludedReceipts = receiptsAll.filter(
    (r) => !isEffectiveReceipt(r) && inRange(r.receiptDate ?? r.createdAt, range.start, range.end),
  );
  const excludedDispatches = dispatchesAll.filter(
    (d) => !isEffectiveDispatch(d) && inRange(d.dispatchDate ?? d.createdAt, range.start, range.end),
  );
  const excluded = {
    receipts: excludedReceipts.length,
    receiptsValue: excludedReceipts.reduce((s, r) => s + receiptValue(r), 0),
    dispatches: excludedDispatches.length,
    dispatchesCost: excludedDispatches.reduce((s, d) => s + dispatchCost(d), 0),
    binCounts: countsAll.filter(
      (c) => !isEffectiveCount(c) && inRange(c.countDate ?? c.createdAt, range.start, range.end),
    ).length,
    transfers: transfersAll.filter(
      (t) => !isEffectiveTransfer(t) && inRange(t.transferDate ?? t.createdAt, range.start, range.end),
    ).length,
  };

  // ── Integrity checks ──
  const integrity: IntegrityIssue[] = [];

  if (openingStock < -0.005) {
    integrity.push({
      id: "negative-opening",
      severity: "critical",
      title: "Opening stock is negative",
      detail:
        "More stock has been dispatched than received before this period. Receipts, opening balances or stock adjustments are missing from the data.",
    });
  }

  if (closingStock < -0.005) {
    integrity.push({
      id: "negative-closing",
      severity: "critical",
      title: "Closing stock is negative",
      detail:
        "Consumption exceeds everything received. Check for missing receipts or dispatches recorded against the wrong site.",
    });
  }

  if (Math.abs(liveBaseline) >= 0.005) {
    integrity.push({
      id: "estimated-baseline",
      severity: "warning",
      title: "Opening stock includes an estimated baseline",
      detail: `No opening balance or closed period exists, so SZL ${round2(
        liveBaseline,
      ).toLocaleString()} (live inventory less everything the documents explain) was added as the stock held before the first recorded document. Record a real opening balance to replace this estimate.`,
    });
  }

  if (excluded.receipts > 0 || excluded.dispatches > 0) {
    integrity.push({
      id: "excluded-documents",
      severity: "info",
      title: "Unfinished documents are excluded",
      detail: `${excluded.receipts} receipt(s) and ${excluded.dispatches} dispatch(es) in this period are draft, cancelled or awaiting evidence, so they are not counted (SZL ${round2(
        excluded.receiptsValue,
      ).toLocaleString()} received, SZL ${round2(
        excluded.dispatchesCost,
      ).toLocaleString()} consumed).`,
    });
  }

  const noPriceLines = periodReceipts.reduce(
    (n, gr) =>
      n +
      (gr.receivedItems || []).filter(
        (i: any) =>
          num(i.receivedQuantity) > 0 &&
          effectiveUnitPrice(i.unitPrice, i.stockItem?.unitPrice) === 0,
      ).length,
    0,
  );
  if (noPriceLines > 0) {
    integrity.push({
      id: "unpriced-lines",
      severity: "warning",
      title: "Received items without a price",
      detail: `${noPriceLines} received line(s) have no price, so they add quantity but no value to Goods Received.`,
    });
  }

  const costMismatch = periodDispatches.filter((d) => {
    const stored = num(d.totalCost);
    if (stored <= 0) return false;
    const fromItems = (d.dispatchedItems || []).reduce(
      (s: number, i: any) =>
        s +
        (num(i.totalCost) > 0
          ? num(i.totalCost)
          : num(i.dispatchedQuantity) *
            effectiveUnitPrice(i.unitPrice, i.stockItem?.unitPrice)),
      0,
    );
    return fromItems > 0 && Math.abs(stored - fromItems) > 0.01;
  }).length;
  if (costMismatch > 0) {
    integrity.push({
      id: "dispatch-cost-mismatch",
      severity: "warning",
      title: "Dispatch totals disagree with their items",
      detail: `${costMismatch} dispatch(es) have a stored total that differs from the sum of their items. The stored total is used.`,
    });
  }

  const noSalesDispatches = periodDispatches.filter(
    (d) => num(d.peopleFed) > 0 && dispatchSales(d) === 0,
  ).length;
  if (noSalesDispatches > 0) {
    integrity.push({
      id: "no-selling-price",
      severity: "warning",
      title: "Dispatches without a selling price",
      detail: `${noSalesDispatches} dispatch(es) fed people but have no selling price, so they contribute no sales.`,
    });
  }

  // Documents with no usable date fall outside every period and silently
  // vanish from the figures (the old UI raised a toast per filter call).
  const undated = [
    ...receiptsAll.filter((r) => !Number.isFinite(timeOf(r.receiptDate ?? r.createdAt))),
    ...dispatchesAll.filter((x) => !Number.isFinite(timeOf(x.dispatchDate ?? x.createdAt))),
    ...countsAll.filter((c) => !Number.isFinite(timeOf(c.countDate ?? c.createdAt))),
  ].length;
  if (undated > 0) {
    integrity.push({
      id: "undated-documents",
      severity: "warning",
      title: "Documents without a valid date",
      detail: `${undated} receipt, dispatch or count record(s) have no valid date and are left out of every period.`,
    });
  }

  // History changed after a period was closed or an opening balance recorded.
  if (anchor && anchor.recordedAt) {
    const recorded = anchor.recordedAt.getTime();
    const edited = [
      ...receiptsAll.map((r) => [r.receiptDate ?? r.createdAt, r.updatedAt]),
      ...dispatchesAll.map((x) => [x.dispatchDate ?? x.createdAt, x.updatedAt]),
      ...countsAll.map((c) => [c.countDate ?? c.createdAt, c.updatedAt]),
    ].filter(([date, updated]) => {
      const d = timeOf(date);
      const u = timeOf(updated);
      return Number.isFinite(d) && Number.isFinite(u) && d < anchorMs && u > recorded;
    }).length;
    if (edited > 0) {
      integrity.push({
        id: "edited-after-close",
        severity: "warning",
        title: "History changed after the period was closed",
        detail: `${edited} document(s) dated before ${anchor.asOf.toISOString().slice(0, 10)} were edited after it was ${
          anchor.kind === "close" ? "closed" : "recorded"
        }. Opening stock uses the closed value; review those documents and re-close the period if the change is valid.`,
      });
    }
  }

  // Reconciliation against live stock — only meaningful when the period runs
  // up to "now" (a historical period cannot be compared with today's stock).
  const live = liveBaseline === 0 ? input.liveInventoryValue : null;
  const endsNow = range.end.getTime() >= now.getTime() - 36 * 3600 * 1000;
  if (
    typeof live === "number" &&
    Number.isFinite(live) &&
    live > 0 &&
    endsNow &&
    (!siteId || siteId === "all")
  ) {
    const gap = closingStock - live;
    const gapPct = Math.abs(gap) / live;
    if (gapPct > 0.1) {
      integrity.push({
        id: "live-stock-gap",
        severity: gapPct > 0.5 ? "critical" : "warning",
        title: "Calculated closing stock differs from live inventory",
        detail: `Calculated closing stock is SZL ${round2(closingStock).toLocaleString()} but live inventory is valued at SZL ${round2(
          live,
        ).toLocaleString()} (${(gapPct * 100).toFixed(
          0,
        )}% apart). Typical causes: missing opening balance or stock adjustments, price differences, or unfinished documents.`,
      });
    }
  }

  return {
    openingStock,
    periodPurchases: period.purchases,
    periodConsumption: period.consumption,
    netVariances: period.variances,
    netTransfers: period.transfers,
    closingStock,
    liveBaseline,
    periodSales,
    peopleFed,
    vatOnPurchases,
    vatOnSales,
    netVATPayable,
    grossProfit,
    profitPercentage,
    anchoredOn: anchor
      ? { kind: anchor.kind, asOf: anchor.asOf.toISOString() }
      : null,
    counts: {
      receipts: periodReceipts.length,
      dispatches: periodDispatches.length,
      binCounts: periodCounts.length,
      transfers: periodTransfers.length,
    },
    excluded,
    integrity,
  };
}

// ─── Formatting ────────────────────────────────────────────────────────────────

/** "SZL 1,137,069.51" — always two decimals, minus sign in front of SZL value. */
export const formatSZL = (value: number | null | undefined): string => {
  const v = Number(value);
  const safe = Number.isFinite(v) ? v : 0;
  const abs = Math.abs(safe).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${safe < 0 ? "-" : ""}SZL ${abs}`;
};

/** Compact form for tight mobile tiles: 3.17M, 408.1K. */
export const formatSZLCompact = (value: number | null | undefined): string => {
  const v = Number(value);
  const safe = Number.isFinite(v) ? v : 0;
  const abs = Math.abs(safe);
  const sign = safe < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}SZL ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}SZL ${(abs / 1_000).toFixed(1)}K`;
  return formatSZL(safe);
};


// ─── Period helpers ────────────────────────────────────────────────────────────

/** The range of equal length ending the instant before `range` starts. */
export function previousRange(range: { start: Date; end: Date }): {
  start: Date;
  end: Date;
} {
  const length = range.end.getTime() - range.start.getTime();
  const end = new Date(range.start.getTime() - 1);
  return { start: new Date(end.getTime() - length), end };
}

/** Percentage change, or null when the previous value is zero/unusable. */
export function percentChange(
  current: number,
  previous: number | null | undefined,
): number | null {
  const p = Number(previous);
  if (!Number.isFinite(p) || Math.abs(p) < 0.005) return null;
  return ((current - p) / Math.abs(p)) * 100;
}

/** "YYYY-MM" key for the month containing `date` (UTC). */
export const monthKey = (date: Date): string =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

/** [start of month, end of month] in UTC for a "YYYY-MM" key. */
export function monthRange(key: string): { start: Date; end: Date } {
  const [y, m] = key.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)),
  };
}

// ─── Drill-down ────────────────────────────────────────────────────────────────

export type DrillKind =
  | "received"
  | "consumed"
  | "sales"
  | "variances"
  | "vat"
  | "excluded"
  | "unpriced"
  | "undated";

export interface DrillRow {
  id: string;
  number: string;
  date: string;
  kind: "receipt" | "dispatch" | "count";
  site: string;
  value: number;
  /** Secondary figure, e.g. VAT or people fed. */
  extra?: string;
  status?: string;
  note?: string;
}

const siteOfReceipt = (gr: any): string =>
  gr?.receivedItems?.[0]?.receivingBin?.site?.name ||
  gr?.receivingBin?.site?.name ||
  gr?.purchaseOrder?.site?.name ||
  "Unknown site";

const siteOfDispatch = (d: any): string =>
  d?.sourceSite?.name ||
  d?.dispatchedItems?.[0]?.sourceBin?.site?.name ||
  "Unknown site";

/**
 * The documents behind a headline figure, for the drill-down drawer. Uses the
 * same inclusion rules and valuation as computeFinancials so the rows add up
 * to the number that was tapped.
 */
export function buildDrillRows(
  kind: DrillKind,
  input: Pick<FinancialInput, "receipts" | "dispatches" | "counts" | "range">,
): DrillRow[] {
  const { range } = input;
  const inPeriod = (v: unknown) => inRange(v, range.start, range.end);
  const receiptDate = (r: any) => r.receiptDate ?? r.createdAt;
  const dispatchDate = (d: any) => d.dispatchDate ?? d.createdAt;
  const countDate = (c: any) => c.countDate ?? c.createdAt;

  const receiptRow = (r: any, extra?: Partial<DrillRow>): DrillRow => ({
    id: r._id,
    number: r.receiptNumber || r._id,
    date: receiptDate(r),
    kind: "receipt",
    site: siteOfReceipt(r),
    value: receiptValue(r),
    status: r.status,
    ...extra,
  });
  const dispatchRow = (d: any, extra?: Partial<DrillRow>): DrillRow => ({
    id: d._id,
    number: d.dispatchNumber || d._id,
    date: dispatchDate(d),
    kind: "dispatch",
    site: siteOfDispatch(d),
    value: dispatchCost(d),
    status: d.status,
    ...extra,
  });

  const receipts = mergeById(input.receipts || [], []);
  const dispatches = mergeById(input.dispatches || [], []);
  const counts = mergeById(input.counts || [], []);

  let rows: DrillRow[] = [];
  switch (kind) {
    case "received":
      rows = receipts
        .filter(isEffectiveReceipt)
        .filter((r) => inPeriod(receiptDate(r)))
        .map((r) => receiptRow(r));
      break;
    case "consumed":
      rows = dispatches
        .filter(isEffectiveDispatch)
        .filter((d) => inPeriod(dispatchDate(d)))
        .map((d) => dispatchRow(d, { extra: `${num(d.peopleFed)} fed` }));
      break;
    case "sales":
      rows = dispatches
        .filter(isEffectiveDispatch)
        .filter((d) => inPeriod(dispatchDate(d)))
        .map((d) =>
          dispatchRow(d, {
            value: dispatchSales(d),
            extra: `${num(d.peopleFed)} × ${dispatchSellingPrice(d).toFixed(2)}`,
          }),
        );
      break;
    case "variances":
      rows = counts
        .filter(isEffectiveCount)
        .filter((c) => inPeriod(countDate(c)))
        .map((c) => ({
          id: c._id,
          number: c.countNumber || c._id,
          date: countDate(c),
          kind: "count" as const,
          site: c.bin?.site?.name || "Unknown site",
          value: countVariance(c),
          status: c.status,
          extra: c.bin?.name,
        }));
      break;
    case "vat":
      rows = receipts
        .filter(isEffectiveReceipt)
        .filter((r) => inPeriod(receiptDate(r)))
        .map((r) =>
          receiptRow(r, { value: round2(receiptVAT(r)), extra: "input VAT" }),
        );
      break;
    case "excluded":
      rows = [
        ...receipts
          .filter((r) => !isEffectiveReceipt(r) && inPeriod(receiptDate(r)))
          .map((r) => receiptRow(r, { note: `Receipt is ${r.status}` })),
        ...dispatches
          .filter((d) => !isEffectiveDispatch(d) && inPeriod(dispatchDate(d)))
          .map((d) =>
            dispatchRow(d, {
              note: `Dispatch is ${d.status || "unfinished"}${
                d.evidenceStatus ? ` · evidence ${d.evidenceStatus}` : ""
              }`,
            }),
          ),
      ];
      break;
    case "unpriced":
      rows = receipts
        .filter(isEffectiveReceipt)
        .filter((r) => inPeriod(receiptDate(r)))
        .filter((r) =>
          (r.receivedItems || []).some(
            (i: any) =>
              num(i.receivedQuantity) > 0 &&
              effectiveUnitPrice(i.unitPrice, i.stockItem?.unitPrice) === 0,
          ),
        )
        .map((r) =>
          receiptRow(r, {
            note: (r.receivedItems || [])
              .filter(
                (i: any) =>
                  num(i.receivedQuantity) > 0 &&
                  effectiveUnitPrice(i.unitPrice, i.stockItem?.unitPrice) === 0,
              )
              .map((i: any) => i.stockItem?.name || "Unknown item")
              .join(", "),
          }),
        );
      break;
    case "undated":
      rows = [
        ...receipts
          .filter((r) => !Number.isFinite(timeOf(receiptDate(r))))
          .map((r) => receiptRow(r)),
        ...dispatches
          .filter((d) => !Number.isFinite(timeOf(dispatchDate(d))))
          .map((d) => dispatchRow(d)),
      ];
      break;
  }
  return rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

/** Which drill-down an integrity issue should open. */
export const drillKindForIssue = (id: string): DrillKind | null =>
  ({
    "excluded-documents": "excluded",
    "unpriced-lines": "unpriced",
    "undated-documents": "undated",
    "no-selling-price": "sales",
    "dispatch-cost-mismatch": "consumed",
  })[id] as DrillKind | null ?? null;

// ─── Reconciliation ────────────────────────────────────────────────────────────

export interface ReconciliationRow {
  itemId: string;
  name: string;
  unit?: string;
  calculatedQty: number;
  liveQty: number;
  gapQty: number;
  unitPrice: number;
  gapValue: number;
  lastCountDate?: string;
  lastCountQty?: number;
}

/**
 * Per-item comparison of the quantity the document ledger implies
 * (received - dispatched + count variances) against live stock. The largest
 * |gapValue| rows are where missing opening balances, unrecorded documents or
 * pricing problems are hiding. All-sites only: transfers net to zero overall.
 */
export function buildReconciliation(input: {
  receipts: any[];
  dispatches: any[];
  counts: any[];
  stockItems: any[];
}): ReconciliationRow[] {
  const qty: Record<string, number> = {};
  const add = (id: string | undefined, q: number) => {
    if (!id) return;
    qty[id] = (qty[id] || 0) + q;
  };

  mergeById(input.receipts || [], [])
    .filter(isEffectiveReceipt)
    .forEach((r) =>
      (r.receivedItems || []).forEach((i: any) =>
        add(i.stockItem?._id, num(i.receivedQuantity)),
      ),
    );
  mergeById(input.dispatches || [], [])
    .filter(isEffectiveDispatch)
    .forEach((d) =>
      (d.dispatchedItems || []).forEach((i: any) =>
        add(i.stockItem?._id, -num(i.dispatchedQuantity)),
      ),
    );

  const lastCount: Record<string, { date: string; qty: number }> = {};
  mergeById(input.counts || [], [])
    .filter(isEffectiveCount)
    .forEach((c) =>
      (c.countedItems || []).forEach((i: any) => {
        const id = i.stockItem?._id;
        if (!id) return;
        let variance = i.variance;
        if (
          (variance === undefined || variance === null) &&
          typeof i.countedQuantity === "number" &&
          typeof i.systemQuantityAtCountTime === "number"
        ) {
          variance = i.countedQuantity - i.systemQuantityAtCountTime;
        }
        add(id, num(variance));
        const when = c.countDate ?? c.createdAt;
        if (
          typeof i.countedQuantity === "number" &&
          (!lastCount[id] || timeOf(when) > timeOf(lastCount[id].date))
        ) {
          lastCount[id] = { date: when, qty: i.countedQuantity };
        }
      }),
    );

  return (input.stockItems || [])
    .filter((s) => s?._id)
    .map((s) => {
      const calculatedQty = qty[s._id] || 0;
      const liveQty = num(s.currentStock);
      const unitPrice = num(s.unitPrice);
      const gapQty = liveQty - calculatedQty;
      return {
        itemId: s._id,
        name: s.name || "Unnamed item",
        unit: s.unitOfMeasure,
        calculatedQty,
        liveQty,
        gapQty,
        unitPrice,
        gapValue: gapQty * unitPrice,
        lastCountDate: lastCount[s._id]?.date,
        lastCountQty: lastCount[s._id]?.qty,
      };
    })
    .filter((r) => Math.abs(r.gapQty) > 0.0005 || r.calculatedQty !== 0)
    .sort((a, b) => Math.abs(b.gapValue) - Math.abs(a.gapValue));
}

// ─── Server response adapter ───────────────────────────────────────────────────

/**
 * Maps the /api/reports/financials response onto the shape the summary
 * component consumes, so it can be shown before the full document download
 * finishes.
 */
export function toSummaryShape(body: any): {
  financial: any;
  summary: any;
  previous: any;
  integrity: IntegrityIssue[];
} | null {
  const f = body?.financial;
  if (!f) return null;
  return {
    financial: {
      openingStock: f.openingStock,
      periodPurchases: f.periodPurchases,
      periodConsumption: f.periodConsumption,
      netVariances: f.netVariances,
      netTransfers: f.netTransfers,
      closingStockValue: f.closingStock,
      periodSales: f.periodSales,
      grossProfitAfterVAT: f.grossProfit,
      profitPercentage: f.profitPercentage,
      vatOnSales: f.vatOnSales,
      vatOnPurchases: f.vatOnPurchases,
      netVATPayable: f.netVATPayable,
      integrity: body.integrity || [],
      excluded: f.excluded,
    },
    summary: {
      totalPeopleFed: f.peopleFed,
      totalDispatches: f.counts?.dispatches,
      totalGoodsReceipts: f.counts?.receipts,
      totalBinCounts: f.counts?.binCounts,
    },
    previous: body.previous || null,
    integrity: body.integrity || [],
  };
}

// ─── Export parity ─────────────────────────────────────────────────────────────

/**
 * Spreadsheet rows describing the data-quality state of a report, so an
 * exported workbook can never disagree with (or hide the caveats shown on)
 * the screen.
 */
export function buildIntegrityRows(
  financial: {
    integrity?: IntegrityIssue[];
    excluded?: {
      receipts: number;
      receiptsValue: number;
      dispatches: number;
      dispatchesCost: number;
    };
  } | null | undefined,
  anchoredOn?: { kind: string; asOf: string } | null,
): (string | number)[][] {
  const issues = financial?.integrity || [];
  const rows: (string | number)[][] = [
    ["DATA QUALITY", ""],
    ["", ""],
    [
      "Status",
      issues.some((i) => i.severity !== "info")
        ? "ATTENTION REQUIRED - see findings below"
        : "No data-quality problems detected",
    ],
    [
      "Opening stock source",
      anchoredOn
        ? `${anchoredOn.kind === "close" ? "Closed period" : "Opening balance"} at ${anchoredOn.asOf.slice(0, 10)} plus later movements`
        : "Rebuilt from full document history",
    ],
  ];
  if (financial?.excluded) {
    rows.push(
      ["Excluded receipts (not completed)", financial.excluded.receipts],
      ["Excluded receipts value", round2(financial.excluded.receiptsValue)],
      ["Excluded dispatches (not completed)", financial.excluded.dispatches],
      ["Excluded dispatches cost", round2(financial.excluded.dispatchesCost)],
    );
  }
  issues.forEach((i) =>
    rows.push([`${i.severity.toUpperCase()}: ${i.title}`, i.detail]),
  );
  rows.push(["", ""], ["", ""]);
  return rows;
}
