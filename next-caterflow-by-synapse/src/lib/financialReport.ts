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

export interface FinancialInput {
  receipts: any[];
  dispatches: any[];
  counts: any[];
  transfers: any[];
  range: { start: Date; end: Date };
  /** Site the data is scoped to (null/"all" = every site). */
  siteId?: string | null;
  /** Live sum(currentStock x unitPrice) used for the reconciliation check. */
  liveInventoryValue?: number | null;
  /** "Now", injectable for tests. */
  now?: Date;
}

export interface FinancialResult {
  openingStock: number;
  periodPurchases: number;
  periodConsumption: number;
  netVariances: number;
  netTransfers: number;
  closingStock: number;
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

  // ── Opening: everything strictly before the period start ──
  const opening = sumLedger(
    receipts.filter((r) => before(r.receiptDate ?? r.createdAt, range.start)),
    dispatches.filter((d) => before(d.dispatchDate ?? d.createdAt, range.start)),
    counts.filter((c) => before(c.countDate ?? c.createdAt, range.start)),
    transfers.filter((t) => before(t.transferDate ?? t.createdAt, range.start)),
    siteId,
  );
  const openingStock =
    opening.purchases - opening.consumption + opening.variances + opening.transfers;

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

  // Reconciliation against live stock — only meaningful when the period runs
  // up to "now" (a historical period cannot be compared with today's stock).
  const live = input.liveInventoryValue;
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
    periodSales,
    peopleFed,
    vatOnPurchases,
    vatOnSales,
    netVATPayable,
    grossProfit,
    profitPercentage,
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
