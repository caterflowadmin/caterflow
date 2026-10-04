import type { IntegrityIssue } from "@/lib/financialReport";

export interface EnhancedAnalyticsData {
  summary: {
    totalPurchaseOrders: number;
    totalGoodsReceipts: number;
    totalDispatches: number;
    totalTransfers: number;
    totalBinCounts: number;
    totalStockItems: number;
    totalSuppliers: number;
    totalUsers: number;
    totalSites: number;
    totalInventoryValue: number;
    totalPeopleFed: number;
    lowStockItems: number;
    criticalStockItems: number;
    totalVATCollected: number; // New VAT summary
    totalVATPaid: number; // New VAT summary
    netVATLiability: number; // New VAT summary
  };
  purchaseOrders: {
    byStatus: Array<{ name: string; value: number }>;
    bySite: Array<{ name: string; value: number }>;
    byMonth: Array<{ name: string; value: number }>;
    totalValue: number;
    vatAmount: number; // New VAT field
    totalWithVAT: number; // New VAT field
    avgOrderValue: number;
    topItems: Array<{
      name: string;
      quantity: number;
      value: number;
      vatAmount: number;
    }>;
    statusBreakdown: { [key: string]: number };
  };
  goodsReceipts: {
    byStatus: Array<{ name: string; value: number }>;
    bySite: Array<{ name: string; value: number }>;
    efficiency: number;
    conditionBreakdown: { [key: string]: number };
    totalValue: number; // New field
    vatAmount: number; // New VAT field
    totalWithVAT: number; // New VAT field
  };
  dispatches: {
    byType: Array<{ name: string; value: number }>;
    bySite: Array<{ name: string; value: number }>;
    totalPeopleFed: number;
    totalCost: number;
    vatAmount: number; // New VAT field
    totalWithVAT: number; // New VAT field
    costPerPerson: number;
    topItems: Array<{
      name: string;
      quantity: number;
      cost: number;
      vatAmount: number;
    }>;
    totalSales: number;
    salesVAT: number; // New VAT field
    salesWithVAT: number; // New VAT field
  };
  transfers: {
    byStatus: Array<{ name: string; value: number }>;
    bySite: Array<{ name: string; value: number }>;
    approvalRate: number;
  };
  inventory: {
    byCategory: Array<{ name: string; value: number }>;
    totalValue: number;
    vatIncluded: number; // New VAT field
    lowStockBreakdown: {
      critical: number;
      warning: number;
      healthy: number;
    };
  };
  binCounts: {
    byStatus: Array<{ name: string; value: number }>;
    accuracy: number;
    varianceAnalysis: {
      positive: {
        quantity: number;
        cost: number;
      };
      negative: {
        quantity: number;
        cost: number;
      };
      zero: {
        quantity: number;
        cost: number;
      };
    };
  };
  financial: {
    monthlySpending: Array<{
      month: string;
      spending: number;
      vat: number;
      totalWithVAT: number;
    }>;
    costPerPersonTrend: Array<{ date: string; cost: number }>;
    inventoryTurnover: number;
    totalReceivedGoodsValue: number;
    totalSales: number;
    consumption: number;
    profit: number;
    profitPercentage: number;
    closingStockValue: number;
    periodPurchases: number;
    periodConsumption: number;
    periodSales: number;
    openingStock: number;
    netVariances: number;
    // VAT-specific financials
    vatOnPurchases: number;
    vatOnSales: number;
    netVATPayable: number;
    grossProfitBeforeVAT: number;
    grossProfitAfterVAT: number;
    // Data-quality findings produced by computeFinancials()
    netTransfers?: number;
    integrity?: IntegrityIssue[];
    excluded?: {
      receipts: number;
      receiptsValue: number;
      dispatches: number;
      dispatchesCost: number;
      binCounts: number;
      transfers: number;
    };
  };
  suppliers: {
    performance: Array<{
      name: string;
      orders: number;
      value: number;
      vatAmount: number;
    }>;
    activeCount: number;
    vatRegisteredCount: number; // New VAT field
  };
  users: {
    byRole: Array<{ name: string; value: number }>;
    activity: Array<{ name: string; actions: number }>;
  };
  vat: {
    summary: {
      totalOutputVAT: number;
      totalInputVAT: number;
      netVATPayable: number;
      vatRate: number;
    };
    breakdown: {
      purchases: { vatAmount: number; totalWithVAT: number };
      sales: { vatAmount: number; totalWithVAT: number };
      inventory: { vatAmount: number; totalWithVAT: number };
    };
  };
}
