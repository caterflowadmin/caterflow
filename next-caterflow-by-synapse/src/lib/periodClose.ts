// src/lib/periodClose.ts
// Pure logic for closing a month and recording an opening balance. The API
// route does auth and persistence; everything decidable lives here so it can
// be unit tested.

import {
  computeFinancials,
  monthRange,
  type FinancialResult,
  type LedgerAnchor,
} from "@/lib/financialReport";
import type { StoredAnchor } from "@/lib/reportAnchors";

export class PeriodCloseError extends Error {
  constructor(
    message: string,
    public code:
      | "invalid-month"
      | "period-not-finished"
      | "blocking-issues"
      | "invalid-value"
      | "invalid-date",
    public issues: FinancialResult["integrity"] = [],
  ) {
    super(message);
  }
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function buildClose(args: {
  month: string;
  siteKey: string;
  docs: { receipts: any[]; dispatches: any[]; counts: any[]; transfers: any[] };
  anchor?: LedgerAnchor | null;
  userId: string;
  force?: boolean;
  now?: Date;
}): { anchor: StoredAnchor; result: FinancialResult } {
  const now = args.now ?? new Date();
  if (!MONTH.test(args.month)) {
    throw new PeriodCloseError("Month must look like 2026-09", "invalid-month");
  }
  const range = monthRange(args.month);
  if (range.end.getTime() >= now.getTime()) {
    throw new PeriodCloseError(
      "A month can only be closed after it has finished",
      "period-not-finished",
    );
  }

  const result = computeFinancials({
    ...args.docs,
    range,
    siteId: args.siteKey === "all" ? null : args.siteKey,
    anchor: args.anchor,
    now,
  });

  const blocking = result.integrity.filter((i) => i.severity === "critical");
  if (blocking.length > 0 && !args.force) {
    throw new PeriodCloseError(
      "Resolve or acknowledge the critical data problems before closing",
      "blocking-issues",
      blocking,
    );
  }

  const asOf = new Date(range.end.getTime() + 1); // first instant of next month
  const recordedAt = now;
  const anchor: StoredAnchor = {
    _id: `close:${args.siteKey}:${args.month}:${recordedAt.getTime()}`,
    kind: "close",
    siteKey: args.siteKey,
    periodKey: args.month,
    asOf,
    value: result.closingStock,
    recordedAt,
    recordedBy: args.userId,
    snapshot: {
      openingStock: result.openingStock,
      purchases: result.periodPurchases,
      consumption: result.periodConsumption,
      variances: result.netVariances,
      transfers: result.netTransfers,
      sales: result.periodSales,
      vatOnSales: result.vatOnSales,
      vatOnPurchases: result.vatOnPurchases,
    },
    reopenedAt: null,
  };
  return { anchor, result };
}

export function buildOpeningBalance(args: {
  asOf: string; // YYYY-MM-DD
  value: number;
  siteKey: string;
  note?: string;
  userId: string;
  now?: Date;
}): StoredAnchor {
  const now = args.now ?? new Date();
  if (!Number.isFinite(args.value) || args.value < 0) {
    throw new PeriodCloseError(
      "Opening balance must be zero or more",
      "invalid-value",
    );
  }
  const asOf = new Date(`${args.asOf}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.asOf) || isNaN(asOf.getTime())) {
    throw new PeriodCloseError("Date must look like 2026-01-01", "invalid-date");
  }
  if (asOf.getTime() > now.getTime()) {
    throw new PeriodCloseError("Date cannot be in the future", "invalid-date");
  }
  return {
    _id: `opening-balance:${args.siteKey}:${args.asOf}:${now.getTime()}`,
    kind: "opening-balance",
    siteKey: args.siteKey,
    asOf,
    value: Math.round(args.value * 100) / 100,
    recordedAt: now,
    recordedBy: args.userId,
    note: args.note?.slice(0, 500),
    reopenedAt: null,
  };
}
