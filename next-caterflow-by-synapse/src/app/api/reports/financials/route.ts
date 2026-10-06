// GET /api/reports/financials?start=YYYY-MM-DD&end=YYYY-MM-DD&site=<id|all>
//
// Server-side financial summary: a ~1 KB answer instead of downloading every
// receipt, dispatch, count and transfer ever recorded. Uses the same
// computeFinancials() as the page, anchored on the latest period close /
// opening balance, so the numbers match everywhere.

import { NextResponse } from "next/server";
import { getUserSiteInfo } from "@/lib/siteFiltering";
import {
  computeFinancials,
  previousRange,
} from "@/lib/financialReport";
import { parseDateRangeBoundary } from "@/lib/dateRangeUtils";
import { loadLedgerDocs, loadLiveInventoryValue } from "@/lib/reportData";
import { getLatestAnchor, toLedgerAnchor } from "@/lib/reportAnchors";
import { canViewFinance } from "@/lib/reportAccess";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  let info;
  try {
    info = await getUserSiteInfo();
  } catch {
    return NextResponse.json({ error: "User not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const start = url.searchParams.get("start") || "";
  const end = url.searchParams.get("end") || "";
  if (!DATE.test(start) || !DATE.test(end)) {
    return NextResponse.json(
      { error: "start and end must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  // Single-site users are always pinned to their own site.
  const requested = url.searchParams.get("site");
  const siteId = info.canAccessMultipleSites
    ? requested && requested !== "all"
      ? requested
      : null
    : info.userSiteId;
  const siteKey = siteId || "all";

  const range = {
    start: parseDateRangeBoundary(start, "start"),
    end: parseDateRangeBoundary(end, "end"),
  };
  if (isNaN(range.start.getTime()) || range.end < range.start) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  const docs = await loadLedgerDocs(siteId);

  let anchorDoc = null;
  let anchorUnavailable = false;
  try {
    anchorDoc = await getLatestAnchor(siteKey, range.start);
  } catch (error) {
    console.warn("financials: could not read period anchors", error);
    anchorUnavailable = true;
  }
  const anchor = anchorDoc ? toLedgerAnchor(anchorDoc) : null;

  // With no closed period / opening balance the ledger has no starting point,
  // so live stock is used to estimate the missing baseline (all sites only).
  const liveInventoryValue =
    !anchor && !siteId ? await loadLiveInventoryValue() : null;

  const result = computeFinancials({
    ...docs,
    range,
    siteId,
    anchor,
    liveInventoryValue,
  });
  const prevRange = previousRange(range);
  let prevAnchor = null;
  try {
    const p = await getLatestAnchor(siteKey, prevRange.start);
    prevAnchor = p ? toLedgerAnchor(p) : null;
  } catch {
    /* previous-period comparison is best effort */
  }
  const previous = computeFinancials({
    ...docs,
    range: prevRange,
    siteId,
    anchor: prevAnchor,
    liveInventoryValue,
  });

  const finance = canViewFinance(info.userRole);
  const { integrity, ...numbers } = result;
  const body = {
    range: { start, end },
    siteKey,
    // Everyone sees operational figures; VAT is finance-only.
    financial: finance
      ? numbers
      : {
          ...numbers,
          vatOnPurchases: null,
          vatOnSales: null,
          netVATPayable: null,
        },
    previous: {
      periodSales: previous.periodSales,
      periodConsumption: previous.periodConsumption,
      grossProfit: previous.grossProfit,
      netVATPayable: finance ? previous.netVATPayable : null,
      closingStock: previous.closingStock,
    },
    integrity: [
      ...integrity,
      ...(docs.failed.length
        ? [
            {
              id: "load-failed",
              severity: "critical" as const,
              title: "Some data could not be loaded",
              detail: `Failed to load: ${docs.failed.join(", ")}. Figures are incomplete.`,
            },
          ]
        : []),
      ...(anchorUnavailable
        ? [
            {
              id: "anchors-unavailable",
              severity: "warning" as const,
              title: "Closed periods could not be read",
              detail:
                "Opening stock was rebuilt from full history instead of the last closed period.",
            },
          ]
        : []),
    ],
    anchor: anchorDoc
      ? {
          id: anchorDoc._id,
          kind: anchorDoc.kind,
          asOf: anchorDoc.asOf,
          value: anchorDoc.value,
          recordedAt: anchorDoc.recordedAt,
          periodKey: anchorDoc.periodKey ?? null,
        }
      : null,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
