import {
  calculateDispatchVAT,
  calculateGoodsReceiptVAT,
  calculateInventoryVAT,
  calculatePurchaseOrderVAT,
} from "@/lib/reportVat";

describe("calculateGoodsReceiptVAT", () => {
  it("adds 15% on received value and respects zero-rated items", () => {
    const [gr] = calculateGoodsReceiptVAT([
      {
        receivedItems: [
          { receivedQuantity: 10, unitPrice: 10, stockItem: {} },
          { receivedQuantity: 10, unitPrice: 10, stockItem: { isVATApplicable: false } },
        ],
      },
    ]);
    expect(gr.vatAmount).toBe(15);
    expect(gr.totalWithVAT).toBe(215);
  });
});

describe("calculatePurchaseOrderVAT", () => {
  it("treats a missing VAT flag as applicable, like receipts do", () => {
    const [po] = calculatePurchaseOrderVAT([
      { totalAmount: 100, orderedItems: [{ orderedQuantity: 10, unitPrice: 10, stockItem: {} }] },
    ]);
    expect(po.vatAmount).toBe(15);
  });
});

describe("calculateDispatchVAT", () => {
  it("keeps stored sales instead of recomputing from the type's base price", () => {
    const [d] = calculateDispatchVAT([
      { peopleFed: 10, totalSales: 150, dispatchType: { sellingPrice: 99 }, dispatchedItems: [] },
    ]);
    expect(d.totalSales).toBe(150);
    expect(d.salesVAT).toBe(22.5);
  });
  it("falls back to the site price when nothing is stored", () => {
    const [d] = calculateDispatchVAT([
      {
        peopleFed: 10,
        sourceSite: { _id: "s" },
        dispatchType: { sellingPrice: 20, sitePrices: [{ site: { _id: "s" }, price: 12 }] },
        dispatchedItems: [],
      },
    ]);
    expect(d.totalSales).toBe(120);
  });
});

describe("calculateInventoryVAT", () => {
  it("totals VAT on stock value", () => {
    const out = calculateInventoryVAT([{ currentStock: 10, unitPrice: 10 }]);
    expect(out.totalVAT).toBe(15);
    expect(out.items[0].stockValueWithVAT).toBe(115);
  });
});
