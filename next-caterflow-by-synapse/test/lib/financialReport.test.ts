import {
  anchorFromCounts,
  computeFinancials,
  isEffectiveCount,
  dispatchSales,
  dispatchSellingPrice,
  effectiveUnitPrice,
  formatSZL,
  isEffectiveDispatch,
  isEffectiveReceipt,
  mergeById,
  netTransferValue,
  countVariance,
  previousRange,
  percentChange,
  monthKey,
  monthRange,
  buildDrillRows,
  drillKindForIssue,
  buildReconciliation,
} from "@/lib/financialReport";

const d = (s: string) => new Date(s);

const receipt = (
  id: string,
  date: string,
  qty: number,
  price: number,
  extra: any = {},
) => ({
  _id: id,
  receiptDate: date,
  status: "completed",
  receivedItems: [{ receivedQuantity: qty, unitPrice: price, stockItem: { unitPrice: 1 } }],
  ...extra,
});

const dispatch = (
  id: string,
  date: string,
  cost: number,
  extra: any = {},
) => ({
  _id: id,
  dispatchDate: date,
  status: "completed",
  evidenceStatus: "complete",
  totalCost: cost,
  peopleFed: 10,
  sellingPrice: 20,
  totalSales: 200,
  ...extra,
});

describe("effectiveUnitPrice", () => {
  it("prefers a positive line price", () => {
    expect(effectiveUnitPrice(5, 9)).toBe(5);
  });
  it("falls back to the item price when the line price is 0 or missing", () => {
    expect(effectiveUnitPrice(0, 9)).toBe(9);
    expect(effectiveUnitPrice(undefined, 9)).toBe(9);
  });
  it("returns 0 when neither exists", () => {
    expect(effectiveUnitPrice(undefined, undefined)).toBe(0);
  });
});

describe("mergeById", () => {
  it("drops archive duplicates, keeping the primary copy", () => {
    const out = mergeById(
      [{ _id: "a", v: "sanity" }],
      [
        { _id: "a", v: "archive" },
        { _id: "b", v: "archive" },
      ],
    );
    expect(out).toEqual([
      { _id: "a", v: "sanity" },
      { _id: "b", v: "archive" },
    ]);
  });
});

describe("status filters", () => {
  it("keeps completed and legacy receipts, drops draft/cancelled", () => {
    expect(isEffectiveReceipt({ status: "completed" })).toBe(true);
    expect(isEffectiveReceipt({})).toBe(true);
    expect(isEffectiveReceipt({ status: "draft" })).toBe(false);
    expect(isEffectiveReceipt({ status: "cancelled" })).toBe(false);
    expect(isEffectiveReceipt({ status: "partially-received" })).toBe(false);
  });
  it("keeps only dispatches that deducted stock", () => {
    expect(isEffectiveDispatch({ status: "completed", evidenceStatus: "complete" })).toBe(true);
    expect(isEffectiveDispatch({ status: "draft", evidenceStatus: "pending" })).toBe(false);
    expect(isEffectiveDispatch({ status: "cancelled" })).toBe(false);
    expect(isEffectiveDispatch({})).toBe(true);
  });
});

describe("dispatch sales", () => {
  it("never overwrites a stored totalSales", () => {
    expect(
      dispatchSales({
        totalSales: 150,
        peopleFed: 10,
        dispatchType: { sellingPrice: 99 },
      }),
    ).toBe(150);
  });
  it("uses the price stamped on the dispatch before the type's base price", () => {
    expect(
      dispatchSellingPrice({ sellingPrice: 12, dispatchType: { sellingPrice: 20 } }),
    ).toBe(12);
  });
  it("uses the site-specific price when nothing is stamped", () => {
    const row = {
      peopleFed: 5,
      sourceSite: { _id: "site-b" },
      dispatchType: {
        sellingPrice: 20,
        sitePrices: [
          { site: { _id: "site-a" }, price: 15 },
          { site: { _id: "site-b" }, price: 18 },
        ],
      },
    };
    expect(dispatchSellingPrice(row)).toBe(18);
    expect(dispatchSales(row)).toBe(90);
  });
  it("falls back to the base price", () => {
    expect(
      dispatchSales({ peopleFed: 4, dispatchType: { sellingPrice: 20 } }),
    ).toBe(80);
  });
});

describe("countVariance", () => {
  it("prefers stored varianceCost", () => {
    expect(
      countVariance({ countedItems: [{ varianceCost: -12.5, variance: -1, stockItem: { unitPrice: 99 } }] }),
    ).toBe(-12.5);
  });
  it("derives variance from quantities when missing", () => {
    expect(
      countVariance({
        countedItems: [
          { countedQuantity: 8, systemQuantityAtCountTime: 10, stockItem: { unitPrice: 3 } },
        ],
      }),
    ).toBe(-6);
  });
});

describe("netTransferValue", () => {
  const t = (from: string, to: string, qty: number) => ({
    fromBin: { site: { _id: from } },
    toBin: { site: { _id: to } },
    items: [{ transferredQuantity: qty, stockItem: { unitPrice: 2 } }],
  });
  it("is zero for the all-sites view", () => {
    expect(netTransferValue([t("a", "b", 5)], null)).toBe(0);
  });
  it("is positive inflow and negative outflow for a single site", () => {
    expect(netTransferValue([t("a", "b", 5)], "b")).toBe(10);
    expect(netTransferValue([t("a", "b", 5)], "a")).toBe(-10);
    expect(netTransferValue([t("a", "a", 5)], "a")).toBe(0);
  });
});

describe("computeFinancials", () => {
  const sep = { start: d("2026-09-01T00:00:00Z"), end: d("2026-09-30T23:59:59Z") };
  const oct = { start: d("2026-10-01T00:00:00Z"), end: d("2026-10-31T23:59:59Z") };

  const data = {
    receipts: [
      receipt("r0", "2026-08-10T10:00:00Z", 100, 10), // 1000 before Sep
      receipt("r1", "2026-09-05T10:00:00Z", 200, 10), // 2000 in Sep
      receipt("r2", "2026-10-02T10:00:00Z", 50, 10), // 500 in Oct
      receipt("rd", "2026-09-06T10:00:00Z", 999, 10, { status: "draft" }), // ignored
    ],
    dispatches: [
      dispatch("d0", "2026-08-12T10:00:00Z", 400),
      dispatch("d1", "2026-09-07T10:00:00Z", 900),
      dispatch("d2", "2026-10-03T10:00:00Z", 300),
      dispatch("dd", "2026-09-08T10:00:00Z", 777, { status: "draft", evidenceStatus: "pending" }),
    ],
    counts: [
      {
        _id: "c1",
        countDate: "2026-09-15T10:00:00Z",
        status: "completed",
        countedItems: [{ varianceCost: -50 }],
      },
      {
        _id: "c2",
        countDate: "2026-09-16T10:00:00Z",
        status: "draft",
        countedItems: [{ varianceCost: -5000 }],
      },
    ],
    transfers: [],
  };

  it("computes September from the full ledger", () => {
    const r = computeFinancials({ ...data, range: sep });
    expect(r.openingStock).toBe(600); // 1000 - 400
    expect(r.periodPurchases).toBe(2000);
    expect(r.periodConsumption).toBe(900);
    expect(r.netVariances).toBe(-50);
    expect(r.closingStock).toBe(1650); // 600 + 2000 - 900 - 50
    expect(r.periodSales).toBe(200);
    expect(r.grossProfit).toBe(200 - 900);
  });

  it("ignores draft/cancelled documents but reports them", () => {
    const r = computeFinancials({ ...data, range: sep });
    expect(r.excluded.receipts).toBe(1);
    expect(r.excluded.dispatches).toBe(1);
    expect(r.excluded.binCounts).toBe(1);
    expect(r.integrity.some((i) => i.id === "excluded-documents")).toBe(true);
  });

  it("makes October's opening equal September's closing", () => {
    const sepResult = computeFinancials({ ...data, range: sep });
    const octResult = computeFinancials({ ...data, range: oct });
    expect(octResult.openingStock).toBe(sepResult.closingStock);
  });

  it("does not double count a document present in both sources", () => {
    const dup = {
      ...data,
      receipts: [...data.receipts, data.receipts[1]],
    };
    expect(computeFinancials({ ...dup, range: sep }).periodPurchases).toBe(2000);
  });

  it("flags negative opening stock instead of clamping it to zero", () => {
    const r = computeFinancials({
      receipts: [],
      dispatches: [dispatch("x", "2026-08-01T00:00:00Z", 100)],
      counts: [],
      transfers: [],
      range: sep,
    });
    expect(r.openingStock).toBe(-100);
    expect(r.integrity.some((i) => i.id === "negative-opening")).toBe(true);
  });

  it("computes VAT on completed receipts and on sales only", () => {
    const r = computeFinancials({ ...data, range: sep });
    expect(r.vatOnPurchases).toBe(300); // 15% of 2000
    expect(r.vatOnSales).toBe(30); // 15% of 200
    expect(r.netVATPayable).toBe(-270);
  });

  it("warns when calculated closing stock is far from live inventory", () => {
    const r = computeFinancials({
      ...data,
      range: { start: sep.start, end: d("2026-10-04T23:59:59Z") },
      liveInventoryValue: 300,
      // A trusted anchor means no baseline estimate, so the gap is reported.
      anchor: { kind: "opening-balance", asOf: d("2026-01-01T00:00:00Z"), value: 0 },
      now: d("2026-10-04T12:00:00Z"),
    });
    expect(r.integrity.some((i) => i.id === "live-stock-gap")).toBe(true);
  });

  it("skips the live reconciliation for a historical period", () => {
    const r = computeFinancials({
      ...data,
      range: sep,
      liveInventoryValue: 300,
      now: d("2026-10-04T12:00:00Z"),
    });
    expect(r.integrity.some((i) => i.id === "live-stock-gap")).toBe(false);
  });

  it("counts a record stamped exactly at the period start in the period, not the opening", () => {
    const r = computeFinancials({
      receipts: [receipt("edge", "2026-09-01T00:00:00Z", 10, 10)],
      dispatches: [],
      counts: [],
      transfers: [],
      range: sep,
    });
    expect(r.openingStock).toBe(0);
    expect(r.periodPurchases).toBe(100);
  });
});

describe("formatSZL", () => {
  it("always uses two decimals and groups thousands", () => {
    expect(formatSZL(117101.361)).toBe("SZL 117,101.36");
    expect(formatSZL(1137069.51)).toBe("SZL 1,137,069.51");
    expect(formatSZL(-43390.782)).toBe("-SZL 43,390.78");
    expect(formatSZL(undefined)).toBe("SZL 0.00");
  });
});

describe("ledger anchors (period close / opening balance)", () => {
  const range = { start: d("2026-10-01T00:00:00Z"), end: d("2026-10-31T23:59:59Z") };
  const base = {
    receipts: [
      receipt("old", "2026-07-01T00:00:00Z", 10, 10), // covered by anchor
      receipt("post", "2026-09-10T00:00:00Z", 20, 10), // after anchor: 200
    ],
    dispatches: [dispatch("dpost", "2026-09-20T00:00:00Z", 50)],
    counts: [],
    transfers: [],
    range,
  };

  it("starts from the anchor value and ignores documents it covers", () => {
    const r = computeFinancials({
      ...base,
      anchor: { kind: "close", asOf: d("2026-09-01T00:00:00Z"), value: 5000 },
    });
    expect(r.openingStock).toBe(5000 + 200 - 50);
    expect(r.anchoredOn?.kind).toBe("close");
  });

  it("ignores an anchor dated after the period start", () => {
    const r = computeFinancials({
      ...base,
      anchor: { kind: "close", asOf: d("2026-11-01T00:00:00Z"), value: 5000 },
    });
    expect(r.anchoredOn).toBeNull();
    expect(r.openingStock).toBe(100 + 200 - 50);
  });

  it("an opening balance fixes an otherwise negative opening", () => {
    const r = computeFinancials({
      receipts: [],
      dispatches: [dispatch("x", "2026-09-05T00:00:00Z", 100)],
      counts: [],
      transfers: [],
      range,
      anchor: { kind: "opening-balance", asOf: d("2026-09-01T00:00:00Z"), value: 1000 },
    });
    expect(r.openingStock).toBe(900);
    expect(r.integrity.some((i) => i.id === "negative-opening")).toBe(false);
  });

  it("warns when closed history was edited after the close", () => {
    const r = computeFinancials({
      ...base,
      receipts: [
        { ...receipt("old", "2026-07-01T00:00:00Z", 10, 10), updatedAt: "2026-09-15T00:00:00Z" },
      ],
      anchor: {
        kind: "close",
        asOf: d("2026-09-01T00:00:00Z"),
        value: 5000,
        recordedAt: d("2026-09-02T00:00:00Z"),
      },
    });
    expect(r.integrity.some((i) => i.id === "edited-after-close")).toBe(true);
  });

  it("reports documents without a valid date", () => {
    const r = computeFinancials({
      receipts: [{ _id: "nodate", status: "completed", receivedItems: [] }],
      dispatches: [],
      counts: [],
      transfers: [],
      range,
    });
    expect(r.integrity.some((i) => i.id === "undated-documents")).toBe(true);
  });
});

describe("period helpers", () => {
  it("previousRange has equal length and ends just before the start", () => {
    const r = { start: d("2026-10-01T00:00:00Z"), end: d("2026-10-04T23:59:59.999Z") };
    const p = previousRange(r);
    expect(p.end.getTime()).toBe(r.start.getTime() - 1);
    expect(p.end.getTime() - p.start.getTime()).toBe(r.end.getTime() - r.start.getTime());
  });
  it("percentChange handles zero/invalid previous values", () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(50, 0)).toBeNull();
    expect(percentChange(50, undefined)).toBeNull();
    expect(percentChange(-50, -100)).toBeCloseTo(50);
  });
  it("monthKey / monthRange round trip", () => {
    expect(monthKey(d("2026-09-15T12:00:00Z"))).toBe("2026-09");
    const r = monthRange("2026-02");
    expect(r.start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-02-28T23:59:59.999Z");
  });
});

describe("buildDrillRows", () => {
  const range = { start: d("2026-09-01T00:00:00Z"), end: d("2026-09-30T23:59:59Z") };
  const input = {
    range,
    receipts: [
      receipt("r1", "2026-09-05T00:00:00Z", 100, 10),
      receipt("r2", "2026-09-06T00:00:00Z", 10, 10),
      receipt("rd", "2026-09-07T00:00:00Z", 5, 10, { status: "draft" }),
      receipt("rz", "2026-09-08T00:00:00Z", 5, 0, {
        receivedItems: [{ receivedQuantity: 5, unitPrice: 0, stockItem: { name: "Rice" } }],
      }),
    ],
    dispatches: [
      dispatch("d1", "2026-09-05T00:00:00Z", 300),
      dispatch("dd", "2026-09-05T00:00:00Z", 999, { status: "draft", evidenceStatus: "pending" }),
    ],
    counts: [],
  };
  it("rows for a figure add up to that figure and are sorted by size", () => {
    const rows = buildDrillRows("received", input);
    expect(rows.map((r) => r.id)).toEqual(["r1", "r2", "rz"]);
    const total = rows.reduce((s, r) => s + r.value, 0);
    expect(total).toBe(computeFinancials({ ...input, transfers: [] }).periodPurchases);
  });
  it("lists excluded and unpriced documents with reasons", () => {
    const ex = buildDrillRows("excluded", input);
    expect(ex.map((r) => r.id).sort()).toEqual(["dd", "rd"]);
    const un = buildDrillRows("unpriced", input);
    expect(un[0].id).toBe("rz");
    expect(un[0].note).toContain("Rice");
  });
  it("maps integrity issues to drill-down kinds", () => {
    expect(drillKindForIssue("unpriced-lines")).toBe("unpriced");
    expect(drillKindForIssue("live-stock-gap")).toBeNull();
  });
});

describe("buildReconciliation", () => {
  it("ranks items by the value of the gap between ledger and live stock", () => {
    const rows = buildReconciliation({
      receipts: [
        { status: "completed", receivedItems: [{ receivedQuantity: 100, stockItem: { _id: "a" } }, { receivedQuantity: 10, stockItem: { _id: "b" } }] },
      ],
      dispatches: [
        { status: "completed", evidenceStatus: "complete", dispatchedItems: [{ dispatchedQuantity: 40, stockItem: { _id: "a" } }] },
      ],
      counts: [
        { status: "completed", countDate: "2026-09-01", countedItems: [{ stockItem: { _id: "b" }, countedQuantity: 8, variance: -2 }] },
      ],
      stockItems: [
        { _id: "a", name: "Flour", currentStock: 60, unitPrice: 2 }, // ledger 60 -> gap 0
        { _id: "b", name: "Oil", currentStock: 20, unitPrice: 50 }, // ledger 8 -> gap 12 (600)
      ],
    });
    expect(rows[0].name).toBe("Oil");
    expect(rows[0].gapQty).toBe(12);
    expect(rows[0].gapValue).toBe(600);
    expect(rows[0].lastCountQty).toBe(8);
    expect(rows.find((r) => r.name === "Flour")!.gapQty).toBe(0);
  });
});

import { buildIntegrityRows, toSummaryShape } from "@/lib/financialReport";

describe("export parity", () => {
  it("states attention required when there are warnings", () => {
    const rows = buildIntegrityRows(
      {
        integrity: [{ id: "x", severity: "warning", title: "Unpriced", detail: "3 lines" }],
        excluded: { receipts: 2, receiptsValue: 100.456, dispatches: 1, dispatchesCost: 50 },
      },
      { kind: "close", asOf: "2026-10-01T00:00:00.000Z" },
    );
    const flat = rows.map((r) => r.join("|")).join("\n");
    expect(flat).toContain("ATTENTION REQUIRED");
    expect(flat).toContain("WARNING: Unpriced|3 lines");
    expect(flat).toContain("Closed period at 2026-10-01");
    expect(flat).toContain("Excluded receipts value|100.46");
  });
  it("says clean when only info notes exist", () => {
    const rows = buildIntegrityRows({ integrity: [{ id: "i", severity: "info", title: "t", detail: "d" }] });
    expect(rows.map((r) => r.join("|")).join("\n")).toContain("No data-quality problems detected");
  });
});

describe("toSummaryShape", () => {
  it("maps the server response to the summary component's shape", () => {
    const out = toSummaryShape({
      financial: { openingStock: 1, closingStock: 9, grossProfit: 4, peopleFed: 7, counts: { dispatches: 3, receipts: 2, binCounts: 1 }, periodSales: 10 },
      integrity: [],
      previous: { periodSales: 5 },
    })!;
    expect(out.financial.closingStockValue).toBe(9);
    expect(out.financial.grossProfitAfterVAT).toBe(4);
    expect(out.summary.totalDispatches).toBe(3);
    expect(out.previous.periodSales).toBe(5);
    expect(toSummaryShape({})).toBeNull();
  });
});

describe("live-stock baseline", () => {
  const now = d("2026-10-06T12:00:00Z");
  const docs = {
    receipts: [receipt("r1", "2026-09-10T00:00:00Z", 100, 10)], // +1000
    dispatches: [
      dispatch("d1", "2026-09-15T00:00:00Z", 1500), // -1500
      dispatch("d2", "2026-10-03T00:00:00Z", 500), // -500
    ],
    counts: [],
    transfers: [],
  };
  const sep = { start: d("2026-09-01T00:00:00Z"), end: d("2026-09-30T23:59:59.999Z") };
  const oct = { start: d("2026-10-01T00:00:00Z"), end: d("2026-10-06T23:59:59.999Z") };

  it("is not applied without live stock: ledger stays negative and is flagged", () => {
    const r = computeFinancials({ ...docs, range: sep, now });
    expect(r.liveBaseline).toBe(0);
    expect(r.closingStock).toBe(-500);
    expect(r.integrity.map((i) => i.id)).toContain("negative-closing");
  });

  it("adds the shortfall between live stock and the full ledger as a baseline", () => {
    // ledger to now = 1000 - 2000 = -1000; live = 800 -> baseline 1800
    const r = computeFinancials({ ...docs, range: oct, now, liveInventoryValue: 800 });
    expect(r.liveBaseline).toBe(1800);
    expect(r.closingStock).toBeCloseTo(800, 2);
    expect(r.openingStock).toBeCloseTo(1300, 2);
    expect(r.integrity.map((i) => i.id)).toContain("estimated-baseline");
    expect(r.integrity.map((i) => i.id)).not.toContain("negative-closing");
  });

  it("keeps opening(next) === closing(previous)", () => {
    const a = computeFinancials({ ...docs, range: sep, now, liveInventoryValue: 800 });
    const b = computeFinancials({ ...docs, range: oct, now, liveInventoryValue: 800 });
    expect(b.openingStock).toBeCloseTo(a.closingStock, 2);
  });

  it("is skipped when a trusted anchor exists or the view is one site", () => {
    const anchor = { kind: "opening-balance" as const, asOf: d("2026-01-01T00:00:00Z"), value: 5000 };
    expect(
      computeFinancials({ ...docs, range: oct, now, liveInventoryValue: 800, anchor }).liveBaseline,
    ).toBe(0);
    expect(
      computeFinancials({ ...docs, range: oct, now, liveInventoryValue: 800, siteId: "s1" }).liveBaseline,
    ).toBe(0);
  });

  it("never hides a still-negative period", () => {
    // Live is tiny, so early history can still dip below zero; it must be reported.
    const r = computeFinancials({
      receipts: [receipt("r1", "2026-09-20T00:00:00Z", 100, 10)],
      dispatches: [dispatch("d1", "2026-09-05T00:00:00Z", 900)],
      counts: [],
      transfers: [],
      range: { start: d("2026-09-01T00:00:00Z"), end: d("2026-09-10T00:00:00Z") },
      now,
      liveInventoryValue: 100,
    });
    expect(r.closingStock).toBeLessThan(0);
    expect(r.integrity.map((i) => i.id)).toContain("negative-closing");
  });
});

import { suggestOpeningBalance } from "@/lib/financialReport";

describe("suggestOpeningBalance", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const rcpt = (id: string, date: string, v: number) => ({ _id: id, status: "completed", receiptDate: date, receivedItems: [{ receivedQuantity: 1, unitPrice: v }] });
  const disp = (id: string, date: string, c: number) => ({ _id: id, status: "completed", evidenceStatus: "complete", dispatchDate: date, totalCost: c });

  const docs = {
    receipts: [rcpt("r1", "2026-08-01T08:00:00Z", 100), rcpt("r2", "2026-09-10T08:00:00Z", 500)],
    dispatches: [disp("d1", "2026-08-05T08:00:00Z", 400), disp("d2", "2026-09-20T08:00:00Z", 300)],
    counts: [], transfers: [],
  };

  it("finds the deepest dip and the date it happened", () => {
    // 100 -> -300 (5 Aug) -> +200 (10 Sep) -> -100 (20 Sep)
    const s = suggestOpeningBalance({ ...docs, now });
    expect(s.lowestPoint).toEqual({ value: -300, date: "2026-08-05" });
    expect(s.minimumToStayNonNegative).toBe(300);
    expect(s.ledgerNow).toBe(-100);
    expect(s.asOf).toBe("2026-08-01");
  });

  it("uses live stock when it is consistent with the non-negative minimum", () => {
    const s = suggestOpeningBalance({ ...docs, liveInventoryValue: 450, now });
    expect(s.fromLiveStock).toBe(550); // 450 - (-100)
    expect(s.recommended).toBe(550);
    expect(s.basis).toBe("live-stock");
  });

  it("falls back to the minimum when live stock implies less than the ledger needs", () => {
    const s = suggestOpeningBalance({ ...docs, liveInventoryValue: 100, now });
    expect(s.fromLiveStock).toBe(200);
    expect(s.recommended).toBe(300);
    expect(s.basis).toBe("non-negative-minimum");
    expect(s.notes.join(" ")).toMatch(/missing receipts/);
  });

  it("recommends the minimum when no live value is given", () => {
    const s = suggestOpeningBalance({ ...docs, now });
    expect(s.recommended).toBe(300);
    expect(s.fromLiveStock).toBeNull();
  });

  it("ignores drafts, duplicates and future documents", () => {
    const s = suggestOpeningBalance({
      receipts: [rcpt("r1", "2026-08-01T00:00:00Z", 100), rcpt("r1", "2026-08-01T00:00:00Z", 100), { ...rcpt("rd", "2026-08-02T00:00:00Z", 999), status: "draft" }, rcpt("rf", "2026-12-01T00:00:00Z", 999)],
      dispatches: [], counts: [], transfers: [], now,
    });
    expect(s.ledgerNow).toBe(100);
    expect(s.minimumToStayNonNegative).toBe(0);
  });

  it("does not treat same-instant receipt then dispatch as a dip", () => {
    const s = suggestOpeningBalance({
      receipts: [rcpt("r", "2026-08-01T10:00:00Z", 100)],
      dispatches: [disp("d", "2026-08-01T10:00:00Z", 100)],
      counts: [], transfers: [], now,
    });
    expect(s.minimumToStayNonNegative).toBe(0);
  });

  it("reports nothing to calculate from when there are no documents", () => {
    const s = suggestOpeningBalance({ receipts: [], dispatches: [], counts: [], transfers: [], now });
    expect(s.basis).toBe("none");
    expect(s.asOf).toBeNull();
  });
});

describe("anchorFromCounts", () => {
  const count = (id: string, bin: string, date: string, qty: number, status = "completed") => ({
    _id: id,
    status,
    countDate: date,
    bin: { _id: bin, site: { _id: "s1" } },
    countedItems: [{ countedQuantity: qty, unitPrice: 10 }],
  });

  it("anchors on the latest effective count day before start, one count per bin", () => {
    const counts = [
      count("a", "b1", "2026-09-10T00:00:00.000Z", 1),
      count("b", "b1", "2026-09-30T00:00:00.000Z", 5),
      count("c", "b2", "2026-09-30T00:00:00.000Z", 3),
    ].filter(isEffectiveCount);
    const a = anchorFromCounts(counts, "s1", new Date("2026-10-01T00:00:00.000Z"));
    expect(a).toMatchObject({ kind: "count", value: 80 });
    expect(a!.asOf.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("returns null for all-sites or when no count precedes the period", () => {
    const counts = [count("a", "b1", "2026-09-30T00:00:00.000Z", 5)];
    expect(anchorFromCounts(counts, null, new Date("2026-10-01"))).toBeNull();
    expect(anchorFromCounts(counts, "s1", new Date("2026-09-01"))).toBeNull();
  });
});
