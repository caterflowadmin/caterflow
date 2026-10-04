// src/lib/reportVat.ts
// Pure VAT decoration of purchase orders, goods receipts, dispatches and stock
// items for the reports page. Extracted from the page component, where these
// were useCallback wrappers with empty dependency lists (i.e. already pure).

import { VAT_CONFIG } from "@/lib/vatConfig";
import { dispatchSales } from "@/lib/financialReport";
import { resolveUnitPrice } from "@/lib/unitPriceResolver";

// Calculate VAT for purchase order items
export const calculatePurchaseOrderVAT = (purchaseOrders: any[]): any[] => {
  return purchaseOrders.map((po) => {
    let totalVAT = 0;
    let totalWithVAT = 0;

    const itemsWithVAT =
      po.orderedItems?.map((item: any) => {
        // DEFENSIVE: Check if VAT field exists
        const isVATApplicable = item.stockItem?.isVATApplicable !== false;
        const itemTotal =
          (item.orderedQuantity || 0) *
          resolveUnitPrice(item.unitPrice, item.stockItem?.unitPrice);
        const { vatAmount, totalWithVAT: itemTotalWithVAT } =
          VAT_CONFIG.calculateVAT(itemTotal, isVATApplicable);

        totalVAT += vatAmount;
        totalWithVAT += itemTotalWithVAT;

        return {
          ...item,
          vatAmount,
          totalWithVAT: itemTotalWithVAT,
          isVATApplicable, // Add this for clarity
        };
      }) || [];

    return {
      ...po,
      orderedItems: itemsWithVAT,
      vatAmount: totalVAT,
      totalWithVAT: totalWithVAT || po.totalAmount,
      hasVATCalculations: true, // Flag to track
    };
  });
};

// Calculate VAT for goods receipt items
// Replace the existing calculateGoodsReceiptVAT function with this:
export const calculateGoodsReceiptVAT = (goodsReceipts: any[]): any[] => {
  return goodsReceipts.map((gr) => {
    let totalVAT = 0;
    let totalWithVAT = 0;

    const itemsWithVAT =
      gr.receivedItems?.map((item: any) => {
        const isVATApplicable = item.stockItem?.isVATApplicable !== false;
        const itemTotal =
          (item.receivedQuantity || 0) *
          resolveUnitPrice(item.unitPrice, item.stockItem?.unitPrice);
        const { vatAmount, totalWithVAT: itemTotalWithVAT } =
          VAT_CONFIG.calculateVAT(itemTotal, isVATApplicable);

        totalVAT += vatAmount;
        totalWithVAT += itemTotalWithVAT;

        return {
          ...item,
          vatAmount,
          totalWithVAT: itemTotalWithVAT,
        };
      }) || [];

    return {
      ...gr,
      receivedItems: itemsWithVAT,
      vatAmount: totalVAT,
      totalWithVAT: totalWithVAT,
    };
  });
};

// Calculate VAT for dispatch items
// Replace the existing calculateDispatchVAT function with this:
export const calculateDispatchVAT = (dispatches: any[]): any[] => {
  return dispatches.map((dispatch) => {
    let totalVAT = 0;
    let totalWithVAT = 0;

    const itemsWithVAT =
      dispatch.dispatchedItems?.map((item: any) => {
        const isVATApplicable = item.stockItem?.isVATApplicable !== false;
        const itemTotal =
          item.totalCost ||
          (item.dispatchedQuantity || 0) *
            resolveUnitPrice(item.unitPrice, item.stockItem?.unitPrice);
        const { vatAmount, totalWithVAT: itemTotalWithVAT } =
          VAT_CONFIG.calculateVAT(itemTotal, isVATApplicable);

        totalVAT += vatAmount;
        totalWithVAT += itemTotalWithVAT;

        return {
          ...item,
          vatAmount,
          totalWithVAT: itemTotalWithVAT,
        };
      }) || [];

    // Sales: keep the figure stored on the dispatch. Only when there is none
    // fall back to the stamped / site-specific / base price (see
    // dispatchSales). The old code always recomputed from the type's base
    // price, which ignored site pricing and rewrote history whenever a
    // price changed.
    const totalSales = dispatchSales(dispatch);
    const salesVAT = VAT_CONFIG.calculateVAT(totalSales, true).vatAmount;
    const salesWithVAT = totalSales + salesVAT;

    return {
      ...dispatch,
      dispatchedItems: itemsWithVAT,
      vatAmount: totalVAT,
      totalWithVAT: totalWithVAT,
      salesVAT: salesVAT,
      salesWithVAT: salesWithVAT,
      totalSales: totalSales,
    };
  });
};

// Calculate VAT for inventory values
export const calculateInventoryVAT = (
  stockItems: any[],
): { items: any[]; totalVAT: number } => {
  let totalVAT = 0;

  const itemsWithVAT = stockItems.map((item) => {
    const isVATApplicable = item.isVATApplicable !== false;
    const stockValue =
      (item.currentStock || 0) *
      resolveUnitPrice(item.unitPrice, item.stockItem?.unitPrice);
    const { vatAmount } = VAT_CONFIG.calculateVAT(stockValue, isVATApplicable);

    totalVAT += vatAmount;

    return {
      ...item,
      stockVAT: vatAmount,
      stockValueWithVAT: stockValue + vatAmount,
    };
  });

  return {
    items: itemsWithVAT,
    totalVAT,
  };
};
