import React from "react";
import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import FinancialSummary from "../../src/app/reports/FinancialSummary";

const base = {
  openingStock: 1137069.51,
  periodPurchases: 408062.6,
  periodConsumption: 272099.77,
  netVariances: -5210.16,
  closingStockValue: 1267822.18,
  periodSales: 563092.8,
  grossProfitAfterVAT: 290993.03,
  profitPercentage: 51.7,
  vatOnSales: 84463.92,
  vatOnPurchases: 61209.39,
  netVATPayable: 23254.53,
  integrity: [],
};

const renderIt = (financial: any) =>
  render(
    <ChakraProvider>
      <FinancialSummary
        financial={financial}
        summary={{
          totalPeopleFed: 25974,
          totalDispatches: 210,
          totalGoodsReceipts: 64,
          totalBinCounts: 4,
        }}
        periodStart="2026-10-01"
        periodEnd="2026-10-04"
        vatRatePercentage={15}
      />
    </ChakraProvider>,
  );

describe("FinancialSummary", () => {
  it("shows the stock movement statement with two-decimal figures", () => {
    renderIt(base);
    expect(screen.getByText("SZL 1,137,069.51")).toBeInTheDocument();
    expect(screen.getByText("SZL 1,267,822.18")).toBeInTheDocument();
    expect(screen.getByText("-SZL 5,210.16")).toBeInTheDocument();
    expect(screen.getByText(/no data-quality problems/i)).toBeInTheDocument();
  });

  it("surfaces integrity problems instead of a blanket success banner", () => {
    renderIt({
      ...base,
      integrity: [
        {
          id: "live-stock-gap",
          severity: "critical",
          title: "Calculated closing stock differs from live inventory",
          detail: "Gap of 40%",
        },
      ],
    });
    expect(
      screen.getByText("Calculated closing stock differs from live inventory"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no data-quality problems/i)).toBeNull();
  });
});
