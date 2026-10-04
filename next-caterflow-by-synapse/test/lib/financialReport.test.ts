import {
  computeFinancials,
  dispatchSales,
  dispatchSellingPrice,
  effectiveUnitPrice,
  formatSZL,
  isEffectiveDispatch,
  isEffectiveReceipt,
  mergeById,
  netTransferValue,
  countVariance,
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
