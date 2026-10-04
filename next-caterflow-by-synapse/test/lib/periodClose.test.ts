import { buildClose, buildOpeningBalance, PeriodCloseError } from "@/lib/periodClose";
import { computeFinancials, monthRange } from "@/lib/financialReport";

const now = new Date("2026-10-04T12:00:00Z");
const docs = {
  receipts: [
    { _id: "r1", status: "completed", receiptDate: "2026-09-05T00:00:00Z", receivedItems: [{ receivedQuantity: 10, unitPrice: 10 }] },
  ],
  dispatches: [
    { _id: "d1", status: "completed", evidenceStatus: "complete", dispatchDate: "2026-09-06T00:00:00Z", totalCost: 40, peopleFed: 5, totalSales: 100 },
  ],
  counts: [],
  transfers: [],
};

describe("buildClose", () => {
  it("stores the month's closing stock, effective from the first instant of the next month", () => {
    const { anchor, result } = buildClose({ month: "2026-09", siteKey: "all", docs, userId: "u1", now });
    expect(anchor.value).toBe(60);
    expect(anchor.value).toBe(result.closingStock);
    expect(anchor.asOf.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(anchor.kind).toBe("close");
    expect(anchor.snapshot?.sales).toBe(100);
  });

  it("makes the next month open at the stored close, even if old history later vanishes", () => {
    const { anchor } = buildClose({ month: "2026-09", siteKey: "all", docs, userId: "u1", now });
    const oct = computeFinancials({
      receipts: [], dispatches: [], counts: [], transfers: [],
      range: monthRange("2026-10"),
      anchor: { kind: "close", asOf: anchor.asOf, value: anchor.value },
    });
    expect(oct.openingStock).toBe(60);
  });

  it("refuses to close a month that has not finished", () => {
    expect(() => buildClose({ month: "2026-10", siteKey: "all", docs, userId: "u", now })).toThrow(PeriodCloseError);
  });

  it("rejects malformed months", () => {
    expect(() => buildClose({ month: "Sept", siteKey: "all", docs, userId: "u", now })).toThrow(/2026-09/);
  });

  it("blocks on critical findings unless forced", () => {
    const bad = { ...docs, receipts: [] }; // dispatch with no stock -> negative closing
    expect(() => buildClose({ month: "2026-09", siteKey: "all", docs: bad, userId: "u", now })).toThrow(/critical/i);
    const forced = buildClose({ month: "2026-09", siteKey: "all", docs: bad, userId: "u", now, force: true });
    expect(forced.anchor.value).toBe(-40);
  });
});

describe("buildOpeningBalance", () => {
  it("creates a dated opening balance", () => {
    const a = buildOpeningBalance({ asOf: "2026-01-01", value: 1234.567, siteKey: "all", userId: "u", now });
    expect(a.kind).toBe("opening-balance");
    expect(a.value).toBe(1234.57);
    expect(a.asOf.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
  it("validates value and date", () => {
    expect(() => buildOpeningBalance({ asOf: "2026-01-01", value: -1, siteKey: "all", userId: "u", now })).toThrow(PeriodCloseError);
    expect(() => buildOpeningBalance({ asOf: "01/01/2026", value: 1, siteKey: "all", userId: "u", now })).toThrow(PeriodCloseError);
    expect(() => buildOpeningBalance({ asOf: "2027-01-01", value: 1, siteKey: "all", userId: "u", now })).toThrow(/future/);
  });
});
